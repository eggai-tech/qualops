import { logger } from '../../shared/utils/logger.ts';
import { type Stage, validateStages } from './option-parser.ts';

export const STAGE_DEPENDENCIES: Partial<Record<Stage, Stage[]>> = {
  review: ['analyze'],
  fix: ['review'],
  report: ['analyze', 'review'],
  judge: ['report', 'fix'],
};

export function enforceStageDependencies(stages: string[]): string[] {
  const stageSet = new Set(stages);
  const result: string[] = [];
  const visited = new Set<string>();
  const visiting = new Set<string>();

  function visit(stage: string): void {
    if (visited.has(stage)) return;
    if (visiting.has(stage)) {
      throw new Error(`Circular dependency detected involving stage: ${stage}`);
    }

    visiting.add(stage);

    const dependencies = STAGE_DEPENDENCIES[stage] || [];
    for (const dep of dependencies) {
      if (stageSet.has(dep)) {
        visit(dep);
      } else if (dependencies.length > 0) {
        logger.warn(`Stage '${stage}' depends on '${dep}' but it's not included. This may cause failures.`);
      }
    }

    visiting.delete(stage);
    visited.add(stage);

    if (stageSet.has(stage)) {
      result.push(stage);
    }
  }

  for (const stage of stages) {
    visit(stage);
  }

  const originalOrder = stages.join(',');
  const newOrder = result.join(',');
  if (originalOrder !== newOrder) {
    logger.info(`Stage order adjusted for dependencies: ${newOrder}`);
  }

  return result;
}

export function validateAndProcessStages(stages: string[]): string[] {
  validateStages(stages);
  return enforceStageDependencies(stages);
}
