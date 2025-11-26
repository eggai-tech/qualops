import { logger } from '../../shared/utils/logger';

export interface StageProgress {
  stage: string;
  startTime: number;
  status: 'running' | 'completed' | 'failed';
}

export class ProgressReporter {
  private currentStage: StageProgress | null = null;

  startStages(stages: string[]): void {
    logger.start(`Running stages: ${stages.join(', ')}`);
  }

  startStage(stage: string): void {
    logger.info(`\n${stage.toUpperCase()}`);
    this.currentStage = {
      stage,
      startTime: Date.now(),
      status: 'running',
    };
  }

  completeStage(): void {
    if (!this.currentStage) {
      return;
    }

    const duration = Date.now() - this.currentStage.startTime;
    logger.info(`${this.currentStage.stage} completed in ${duration}ms`);
    this.currentStage.status = 'completed';
    this.currentStage = null;
  }

  failStage(_error: unknown): void {
    if (this.currentStage) {
      this.currentStage.status = 'failed';
      this.currentStage = null;
    }
  }

  reportSessionInfo(options: { files?: string[] }): void {
    if (options.files && options.files.length > 0) {
      if (options.files.length === 1) {
        logger.info(`Analyzing file: ${options.files[0]}`);
      } else {
        logger.info(`Analyzing ${options.files.length} files`);
        const displayFiles = options.files.slice(0, 3);
        const hasMore = options.files.length > 3;
        logger.info(
          `Files: ${displayFiles.join(', ')}${hasMore ? `... and ${options.files.length - 3} more` : ''}`,
        );
      }
    }
  }

  reportCompletion(sessionPath: string): void {
    logger.summary('QualOps completed successfully');
    logger.info(`View results at: ${sessionPath}`);
  }
}
