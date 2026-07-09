import { logger } from '../../../shared/utils/logger';

type TemplateContext = Record<string, any>;

export class TemplateEngine {
  private static readonly VARIABLE_REGEX = /\{\{([^}]+)\}\}/g;
  private static readonly IF_REGEX = /\{\{#if\s+([^}]+)\}\}([\s\S]*?)\{\{\/if\}\}/g;
  private static readonly EACH_REGEX = /\{\{#each\s+([^}]+)\}\}([\s\S]*?)\{\{\/each\}\}/g;

  static render(template: string, context: TemplateContext): string {
    let result = template;
    result = this.processConditionals(result, context);
    result = this.processLoops(result, context);
    result = this.processVariables(result, context);
    return result;
  }

  private static processConditionals(template: string, context: TemplateContext): string {
    return template.replace(this.IF_REGEX, (match, condition, content) => {
      const conditionValue = this.evaluateCondition(condition.trim(), context);
      return conditionValue ? content : '';
    });
  }

  private static processLoops(template: string, context: TemplateContext): string {
    return template.replace(this.EACH_REGEX, (match, arrayPath, itemTemplate) => {
      const array = this.resolvePath(arrayPath.trim(), context);

      if (!Array.isArray(array)) {
        logger.warn(`[TemplateEngine] Path "${arrayPath}" is not an array`);
        return '';
      }

      return array
        .map((item, index) => {
          const itemContext: TemplateContext = {
            ...context,
            this: item,
            index,
            first: index === 0,
            last: index === array.length - 1,
          };
          return this.render(itemTemplate, itemContext);
        })
        .join('');
    });
  }

  private static processVariables(template: string, context: TemplateContext): string {
    return template.replace(this.VARIABLE_REGEX, (match, path) => {
      const value = this.resolvePath(path.trim(), context);
      return value !== undefined && value !== null ? String(value) : match;
    });
  }

  private static resolvePath(path: string, context: TemplateContext): any {
    const parts = path.split('.');
    let current: any = context;

    for (const part of parts) {
      if (current && typeof current === 'object' && part in current) {
        // nosemgrep: prototype-pollution-loop -- read-only object walk (no write), path from operator-authored templates
        current = current[part];
      } else {
        return undefined;
      }
    }

    return current;
  }

  private static evaluateCondition(condition: string, context: TemplateContext): boolean {
    const comparisonMatch = condition.match(/^(.+?)\s*(===|!==|==|!=|>|<|>=|<=)\s*(.+)$/);

    if (comparisonMatch) {
      const [, left, operator, right] = comparisonMatch;
      const leftValue = this.resolvePath(left.trim(), context);
      const rightValue = this.parseValue(right.trim(), context);

      switch (operator) {
        case '===':
          return leftValue === rightValue;
        case '!==':
          return leftValue !== rightValue;
        case '==':
          return leftValue == rightValue;
        case '!=':
          return leftValue != rightValue;
        case '>':
          return leftValue > rightValue;
        case '<':
          return leftValue < rightValue;
        case '>=':
          return leftValue >= rightValue;
        case '<=':
          return leftValue <= rightValue;
        default:
          return false;
      }
    }

    const value = this.resolvePath(condition, context);
    return Boolean(value);
  }

  private static parseValue(value: string, context: TemplateContext): any {
    if (value.startsWith('"') || value.startsWith("'")) {
      return value.slice(1, -1);
    }

    if (!isNaN(Number(value))) {
      return Number(value);
    }

    if (value === 'true') return true;
    if (value === 'false') return false;

    return this.resolvePath(value, context);
  }
}
