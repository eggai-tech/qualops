import { writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

import { PROSE_NO_ISSUES_SENTINEL, type ProseReview } from '../../../shared/types/prose-review';
import { logger } from '../../../shared/utils/logger';

export function generateProseReport(
  reviews: ProseReview[],
  modelName: string,
  reportPath: string,
): void {
  const timestamp = new Date().toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
  const lines: string[] = [
    '# Code Review Report',
    '',
    `> Model: ${modelName} | Mode: unstructured | ${timestamp}`,
    '',
    '## Issues Found',
    '',
  ];

  const nonEmpty = reviews.filter(
    (r) =>
      r.content.trim() && r.content.trim().toLowerCase() !== PROSE_NO_ISSUES_SENTINEL.toLowerCase(),
  );

  if (nonEmpty.length === 0) {
    lines.push('No issues found.');
  } else {
    for (const review of nonEmpty) {
      const heading = review.file ?? '(whole PR)';
      lines.push(`### ${heading}`, '');
      lines.push(review.content.trim());
      lines.push('');
    }
  }

  const content = lines.join('\n');
  mkdirSync(dirname(reportPath), { recursive: true });
  writeFileSync(reportPath, content, 'utf-8');
  logger.info(`[ProseReport] Written to ${reportPath}`);
}
