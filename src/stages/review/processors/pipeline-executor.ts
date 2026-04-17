import { writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';

import type { Tracer } from '@opentelemetry/api';

import { DeduplicationResolver } from './dedup-resolver';
import { FileReviewer } from './file-reviewer';
import { ValidationResolver } from './validation-resolver';
import type { AIProvider } from '../../../ai/providers/provider';
import { ConfigService } from '../../../config/config';
import {
  getTracer,
  recordSpanError,
  setModelAttribute,
  setObservationIO,
  withAISpan,
} from '../../../observability';
import { getCurrentSessionPaths } from '../../../shared/runtime/session-context';
import type { ReviewIssue } from '../../../shared/types';
import type { FileInfo, PipelineJob, ReviewConfig, ReviewPass } from '../../../shared/types/config';
import { processConcurrently } from '../../../shared/utils/concurrency';
import { logger } from '../../../shared/utils/logger';
import { AgenticExecutor } from '../agentic';
import { ConfigLoader } from '../loaders/config-loader';
import { DocDiscovery } from '../loaders/doc-discovery';
import { FilterMatcher } from '../loaders/filter-matcher';
import { PromptLoader } from '../loaders/prompt-loader';
import { TemplateEngine } from '../loaders/template-engine';

export class PipelineExecutor {
  private config: ReviewConfig;
  private validationResolver: ValidationResolver;
  private dedupResolver: DeduplicationResolver;
  private aiProvider: AIProvider;
  private model: string;
  private preValidationDump: Record<string, ReviewIssue[]> = {};

  constructor(aiProvider: AIProvider) {
    this.config = ConfigLoader.getInstance().load();
    this.validationResolver = new ValidationResolver(this.config, aiProvider);
    this.dedupResolver = new DeduplicationResolver(this.config, aiProvider);
    this.aiProvider = aiProvider;
    this.model = ConfigService.getInstance().getAIStageConfig('review').model;
  }

  async execute(files: FileInfo[]): Promise<ReviewIssue[]> {
    logger.info(`[Pipeline] Starting review of ${files.length} files`);

    const allIssues: ReviewIssue[] = [];
    const enabledJobs = ConfigLoader.getInstance().getEnabledJobs();

    for (const { job, passes } of enabledJobs) {
      const mode = job.mode || 'file-by-file';
      logger.info(`[Pipeline] Executing job: ${job.name} (mode: ${mode})`);

      let jobIssues: ReviewIssue[];

      if (mode === 'agentic') {
        jobIssues = await this.executeAgenticJob(job, files);
      } else {
        jobIssues = await this.executeJob(job, passes, files);
      }

      allIssues.push(...jobIssues);
      logger.info(`[Pipeline] Job "${job.name}" completed: ${jobIssues.length} issues`);
    }

    logger.info(`[Pipeline] All jobs completed: ${allIssues.length} total issues`);

    const dumpPath = join(
      getCurrentSessionPaths().base(),
      'issues-before-validation-and-dedup.json',
    );
    writeFileSync(dumpPath, JSON.stringify(this.preValidationDump, null, 2));
    logger.info(`[Pipeline] Pre-validation dump saved to ${dumpPath}`);

    return allIssues;
  }

  private async executeAgenticJob(job: PipelineJob, files: FileInfo[]): Promise<ReviewIssue[]> {
    const tracer = getTracer();
    const filePaths = files.map((f) => f.path);

    return tracer.startActiveSpan(`job/${job.name}`, async (span) => {
      try {
        setModelAttribute(span, this.model);
        setObservationIO(span, { input: { files: filePaths, mode: 'agentic' } });
        const rawIssues = await this.runAgenticReview(job, files);
        const issues = await this.validateAndDedup(tracer, job, rawIssues);
        setObservationIO(span, { output: issues });
        return issues;
      } catch (error) {
        recordSpanError(span, error);
        throw error;
      } finally {
        span.end();
      }
    });
  }

  private async runAgenticReview(job: PipelineJob, files: FileInfo[]): Promise<ReviewIssue[]> {
    logger.info(`[Pipeline] Starting agentic review for job: ${job.name}`);

    const executor = new AgenticExecutor(job, undefined, this.model);
    const rawIssues = await executor.execute(files);

    this.preValidationDump[job.name] = rawIssues;
    return rawIssues;
  }

  private async executeJob(
    job: PipelineJob,
    passes: ReviewPass[],
    files: FileInfo[],
  ): Promise<ReviewIssue[]> {
    const tracer = getTracer();
    const filePaths = files.map((f) => f.path);

    return tracer.startActiveSpan(`job/${job.name}`, async (span) => {
      try {
        setModelAttribute(span, this.model);
        setObservationIO(span, { input: { files: filePaths, mode: job.mode || 'file-by-file' } });
        const rawIssues = await this.runPasses(job, passes, files);
        const issues = await this.validateAndDedup(tracer, job, rawIssues);
        setObservationIO(span, { output: issues });
        return issues;
      } catch (error) {
        recordSpanError(span, error);
        throw error;
      } finally {
        span.end();
      }
    });
  }

  private async runPasses(
    job: PipelineJob,
    passes: ReviewPass[],
    files: FileInfo[],
  ): Promise<ReviewIssue[]> {
    const rawIssues: ReviewIssue[] = [];

    for (const pass of passes) {
      logger.info(`[Pipeline] Executing pass: ${pass.name}`);
      const passIssues = await this.executePass(pass, files);
      rawIssues.push(...passIssues);
      logger.info(`[Pipeline] Pass "${pass.name}" completed: ${passIssues.length} raw issues`);
    }

    this.preValidationDump[job.name] = rawIssues;
    return rawIssues;
  }

  private async validateAndDedup(
    tracer: Tracer,
    job: PipelineJob,
    rawIssues: ReviewIssue[],
  ): Promise<ReviewIssue[]> {
    const validatedIssues = await withAISpan(tracer, 'validation', this.model, async () => {
      return this.validationResolver.validate(rawIssues, job);
    });
    logger.info(
      `[Pipeline] Job "${job.name}" validation: ${validatedIssues.length}/${rawIssues.length} issues passed`,
    );

    const dedupedIssues = await withAISpan(tracer, 'deduplication', this.model, async () => {
      return this.dedupResolver.deduplicate(validatedIssues, job);
    });
    logger.info(
      `[Pipeline] Job "${job.name}" deduplication: ${dedupedIssues.length}/${validatedIssues.length} issues kept`,
    );

    return dedupedIssues;
  }

  private async executePass(pass: ReviewPass, files: FileInfo[]): Promise<ReviewIssue[]> {
    const filteredFiles = files.filter((file) => FilterMatcher.shouldReview(file, pass));

    if (filteredFiles.length === 0) {
      logger.info(`[Pipeline] No files match filters for pass "${pass.name}"`);
      return [];
    }

    logger.info(`[Pipeline] ${filteredFiles.length} files match filters for pass "${pass.name}"`);

    const tracer = getTracer();

    return withAISpan(tracer, `pass/${pass.name}`, this.model, async () => {
      if (pass.docs) {
        return this.executeDocBasedPass(pass, filteredFiles);
      }
      return this.executePromptOnlyPass(pass, filteredFiles);
    });
  }

  private async executeDocBasedPass(pass: ReviewPass, files: FileInfo[]): Promise<ReviewIssue[]> {
    const docPaths = await DocDiscovery.discover(pass.docs as string);
    const { content: promptTemplate } = await PromptLoader.load(pass.prompt);
    const allIssues: ReviewIssue[] = [];

    for (const [index, docPath] of docPaths.entries()) {
      logger.info(`[Pipeline] Processing doc split ${index + 1}/${docPaths.length}: ${docPath}`);

      const docContent = await readFile(docPath, 'utf-8');
      const renderedPrompt = TemplateEngine.render(promptTemplate, {
        DOCUMENTATION: docContent,
        MIN_CONFIDENCE: this.config.validation?.minConfidence ?? 7,
        REVIEW_MIN_CONFIDENCE: this.config.minConfidence ?? 4,
      });
      const issues = await this.reviewWithPrompt(renderedPrompt, files, pass);

      allIssues.push(...issues);
    }

    return allIssues;
  }

  private async executePromptOnlyPass(pass: ReviewPass, files: FileInfo[]): Promise<ReviewIssue[]> {
    const { content: promptTemplate } = await PromptLoader.load(pass.prompt);
    const renderedPrompt = TemplateEngine.render(promptTemplate, {
      MIN_CONFIDENCE: this.config.validation?.minConfidence ?? 7,
      REVIEW_MIN_CONFIDENCE: this.config.minConfidence ?? 4,
    });
    return await this.reviewWithPrompt(renderedPrompt, files, pass);
  }

  private async reviewWithPrompt(
    prompt: string,
    files: FileInfo[],
    pass: ReviewPass,
  ): Promise<ReviewIssue[]> {
    logger.debug(
      `[Pipeline] Review with prompt (${prompt.length} chars) for ${files.length} files`,
    );

    const maxConcurrent = this.config.maxConcurrentFiles || 10;
    const reviewer = new FileReviewer(this.aiProvider, prompt, pass.name);

    const results = await processConcurrently(files, maxConcurrent, async (file, index) => {
      logger.info(`[${index + 1}/${files.length}] Reviewing ${file.path} with "${pass.name}"`);
      const issues = await reviewer.reviewFile(file);
      logger.info(`[${index + 1}/${files.length}] Found ${issues.length} issues in ${file.path}`);
      return issues;
    });

    return results.flat();
  }
}
