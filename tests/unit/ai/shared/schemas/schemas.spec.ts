import { z } from 'zod';

import { DedupIndicesSchema } from '@/ai/shared/schemas/dedup-indices';
import { ReviewIssueItemSchema, ReviewIssuesSchema } from '@/ai/shared/schemas/review-issue';
import {
  RootCauseClassificationItemSchema,
  RootCauseClassificationsSchema,
} from '@/ai/shared/schemas/root-cause-classification';
import { SearchReplaceFixSchema } from '@/ai/shared/schemas/search-replace-fix';
import {
  ValidationResultItemSchema,
  ValidationResultsSchema,
} from '@/ai/shared/schemas/validation-result';

describe('ReviewIssueItemSchema', () => {
  const minimalValid = {
    type: 'bug',
    severity: 'high',
    description: 'Null pointer',
    location: 'line:42',
    confidence: 8,
  };

  it('accepts a minimal valid issue and applies string defaults for omitted fields', () => {
    const parsed = ReviewIssueItemSchema.parse(minimalValid);
    expect(parsed.reasoning).toBe('');
    expect(parsed.context).toBe('');
    expect(parsed.suggestion).toBe('');
  });

  it('rejects empty description', () => {
    expect(() => ReviewIssueItemSchema.parse({ ...minimalValid, description: '' })).toThrow();
  });

  it('rejects out-of-range confidence', () => {
    expect(() => ReviewIssueItemSchema.parse({ ...minimalValid, confidence: 0 })).toThrow();
    expect(() => ReviewIssueItemSchema.parse({ ...minimalValid, confidence: 11 })).toThrow();
  });

  it('rejects unknown severity', () => {
    expect(() => ReviewIssueItemSchema.parse({ ...minimalValid, severity: 'urgent' })).toThrow();
  });

  it('rejects unknown type', () => {
    expect(() => ReviewIssueItemSchema.parse({ ...minimalValid, type: 'style' })).toThrow();
  });

  it('preserves optional fields when present', () => {
    const parsed = ReviewIssueItemSchema.parse({
      ...minimalValid,
      impact: 'data exfiltration',
      cwe: 'CWE-79',
      threat_model: 'untrusted user input',
      effort: 'low',
    });
    expect(parsed.impact).toBe('data exfiltration');
    expect(parsed.cwe).toBe('CWE-79');
    expect(parsed.threat_model).toBe('untrusted user input');
    expect(parsed.effort).toBe('low');
  });
});

describe('ReviewIssuesSchema', () => {
  it('accepts an empty array', () => {
    expect(ReviewIssuesSchema.parse([])).toEqual([]);
  });

  it('rejects a non-array root', () => {
    expect(() => ReviewIssuesSchema.parse({ not: 'an array' })).toThrow();
  });
});

describe('ValidationResultItemSchema', () => {
  const valid = {
    index: 0,
    is_false_positive: false,
    confidence: 8,
    severity: 'high' as const,
    reasoning: 'Confirmed',
  };

  it('accepts a valid validation entry', () => {
    expect(ValidationResultItemSchema.parse(valid)).toEqual(valid);
  });

  it('rejects negative index', () => {
    expect(() => ValidationResultItemSchema.parse({ ...valid, index: -1 })).toThrow();
  });

  it('rejects non-integer confidence', () => {
    expect(() => ValidationResultItemSchema.parse({ ...valid, confidence: 8.5 })).toThrow();
  });
});

describe('ValidationResultsSchema', () => {
  it('accepts an empty array', () => {
    expect(ValidationResultsSchema.parse([])).toEqual([]);
  });
});

describe('DedupIndicesSchema', () => {
  it('accepts an array of non-negative integers', () => {
    expect(DedupIndicesSchema.parse([0, 1, 5])).toEqual([0, 1, 5]);
  });

  it('accepts an empty array', () => {
    expect(DedupIndicesSchema.parse([])).toEqual([]);
  });

  it('rejects negative numbers', () => {
    expect(() => DedupIndicesSchema.parse([0, -1])).toThrow();
  });

  it('rejects non-integer numbers', () => {
    expect(() => DedupIndicesSchema.parse([0, 1.5])).toThrow();
  });

  it('rejects strings', () => {
    expect(() => DedupIndicesSchema.parse(['0', '1'])).toThrow();
  });
});

describe('SearchReplaceFixSchema', () => {
  const valid = {
    search: 'old code',
    replace: 'new code',
    explanation: 'fix description',
    confidence: 'high' as const,
    breaking: false,
  };

  it('accepts a valid fix', () => {
    expect(SearchReplaceFixSchema.parse(valid)).toEqual(valid);
  });

  it('rejects empty search', () => {
    expect(() => SearchReplaceFixSchema.parse({ ...valid, search: '' })).toThrow();
  });

  it('rejects unknown confidence value', () => {
    expect(() => SearchReplaceFixSchema.parse({ ...valid, confidence: 'maybe' })).toThrow();
  });

  it('rejects non-boolean breaking', () => {
    expect(() => SearchReplaceFixSchema.parse({ ...valid, breaking: 'yes' })).toThrow();
  });
});

describe('RootCauseClassificationItemSchema', () => {
  const valid = {
    issueId: 'ISSUE-001',
    rootCause: 'memory_leaks_cleanup',
    confidence: 9,
  };

  it('accepts a valid classification', () => {
    expect(RootCauseClassificationItemSchema.parse(valid)).toEqual(valid);
  });

  it('rejects out-of-range confidence', () => {
    expect(() => RootCauseClassificationItemSchema.parse({ ...valid, confidence: 0 })).toThrow();
    expect(() => RootCauseClassificationItemSchema.parse({ ...valid, confidence: 11 })).toThrow();
  });

  it('rejects empty rootCause string when not provided', () => {
    expect(() =>
      RootCauseClassificationItemSchema.parse({ issueId: 'X', confidence: 5 }),
    ).toThrow();
  });
});

describe('RootCauseClassificationsSchema', () => {
  it('accepts an empty array', () => {
    expect(RootCauseClassificationsSchema.parse([])).toEqual([]);
  });
});

describe('schema metadata propagation', () => {
  it.each([
    ['ReviewIssuesSchema', ReviewIssuesSchema],
    ['ValidationResultsSchema', ValidationResultsSchema],
    ['DedupIndicesSchema', DedupIndicesSchema],
    ['SearchReplaceFixSchema', SearchReplaceFixSchema],
    ['RootCauseClassificationsSchema', RootCauseClassificationsSchema],
  ])('%s has a root-level description in its JSON Schema', (_name, schema) => {
    const json = z.toJSONSchema(schema as z.ZodType) as Record<string, unknown>;
    expect(typeof json.description).toBe('string');
    expect((json.description as string).length).toBeGreaterThan(0);
  });
});
