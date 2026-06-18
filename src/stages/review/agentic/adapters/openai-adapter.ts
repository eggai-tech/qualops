import { Agent, getGlobalTraceProvider, run, setDefaultOpenAIClient, tool } from '@openai/agents';
import { z } from 'zod';

import type { AgentAdapter, AgentAdapterParams, AgentAdapterResult } from './agent-adapter';
import { ReviewIssuesSchema } from '../../../../ai/shared/schemas/review-issue';
import { envConfig } from '../../../../config/env';
import { logger } from '../../../../shared/utils/logger';
import { createToolSet, type ToolSet } from '../tools';

const ReviewOutputSchema = z.object({ issues: ReviewIssuesSchema });

export class OpenAIAdapter implements AgentAdapter {
  async run(params: AgentAdapterParams): Promise<AgentAdapterResult> {
    const {
      systemPrompt,
      userPrompt,
      agents,
      model,
      cwd,
      maxTurns,
      onToolCall,
      toolConfig,
      skipPatterns,
    } = params;

    await configureOpenAIClient();
    getGlobalTraceProvider().setDisabled(true);

    const toolSet = await createToolSet(cwd, toolConfig, skipPatterns);

    try {
      const tools = buildOpenAITools(toolSet, onToolCall);

      const handoffs = Object.entries(agents).map(([name, def]) => {
        const agentTools = def.tools ? tools.filter((t) => def.tools!.includes(t.name)) : tools;
        return new Agent({
          name,
          model: def.model ?? model,
          instructions: def.prompt,
          tools: agentTools,
        });
      });

      const orchestrator = new Agent({
        name: 'qualops-reviewer',
        model,
        instructions: systemPrompt,
        tools,
        handoffs,
        outputType: ReviewOutputSchema,
      });

      logger.info(`[Agentic/OpenAI] Starting run with model=${model}, maxTurns=${maxTurns}`);

      const result = await run(orchestrator, userPrompt, { maxTurns });

      const usage = result.state.usage;
      const structured = result.finalOutput as z.infer<typeof ReviewOutputSchema> | null;

      logger.info(
        `[Agentic/OpenAI] Run complete. inputTokens=${usage.inputTokens}, outputTokens=${usage.outputTokens}`,
      );
      if (structured?.issues) {
        logger.info(`[Agentic/OpenAI] Structured output (${structured.issues.length} issues)`);
      } else {
        logger.warn('[Agentic/OpenAI] finalOutput was null or missing issues — returning empty');
      }

      return {
        output: '',
        structuredOutput: structured?.issues,
        inputTokens: usage.inputTokens,
        outputTokens: usage.outputTokens,
      };
    } finally {
      await toolSet.dispose();
    }
  }
}

async function configureOpenAIClient(): Promise<void> {
  const apiKey = envConfig.get('openaiApiKey') || '';
  const baseURL = envConfig.get('openaiBaseUrl');

  const { default: OpenAI, AzureOpenAI } = await import('openai');

  // Azure URLs follow the pattern: https://{resource}.openai.azure.com/openai/deployments/{deployment}
  // When detected, use AzureOpenAI with baseURL set to the resource root so that api-version
  // is injected automatically. We pass baseURL explicitly to avoid conflicts with OPENAI_BASE_URL.
  const azureMatch = baseURL?.match(
    /^(https:\/\/[^/]+\.openai\.azure\.com)(\/openai\/deployments\/[^/?]+)?/,
  );
  if (azureMatch) {
    const azureBaseURL = `${azureMatch[1]}/openai`;
    setDefaultOpenAIClient(
      new AzureOpenAI({ apiKey, baseURL: azureBaseURL, apiVersion: '2025-03-01-preview' }),
    );
  } else {
    setDefaultOpenAIClient(new OpenAI({ apiKey, baseURL }));
  }
}

function buildOpenAITools(toolSet: ToolSet, onToolCall?: AgentAdapterParams['onToolCall']) {
  let turnIndex = 0;

  return toolSet.tools.map((def) =>
    tool({
      name: def.name,
      description: def.description,
      parameters: def.schema,
      execute: async (args) => {
        turnIndex++;
        logger.info(`[Agentic/OpenAI] Tool call: ${def.name}`);
        onToolCall?.(turnIndex, def.name, args);
        return def.execute(args as Record<string, unknown>);
      },
    }),
  );
}
