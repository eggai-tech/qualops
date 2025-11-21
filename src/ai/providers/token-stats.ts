import { getGlobalAIProvider } from './factory';
import type { TokenStats } from './provider';

export function getGlobalTokenStats(): TokenStats {
  try {
    const provider = getGlobalAIProvider();
    return (
      provider.getTokenStats?.() ?? {
        totalInputTokens: 0,
        totalOutputTokens: 0,
        totalTokens: 0,
        invocationCount: 0,
        startTime: new Date(),
        estimatedCost: 0,
      }
    );
  } catch {
    // Provider not initialized yet
    return {
      totalInputTokens: 0,
      totalOutputTokens: 0,
      totalTokens: 0,
      invocationCount: 0,
      startTime: new Date(),
      estimatedCost: 0,
    };
  }
}

export function resetTokenStats(): void {
  try {
    getGlobalAIProvider().resetTokenStats?.();
  } catch {
    // Provider not initialized yet, ignore
  }
}
