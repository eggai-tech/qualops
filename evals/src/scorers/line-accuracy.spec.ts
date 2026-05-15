'use strict';

import { scoreLineAccuracy } from './line-accuracy';

describe('scoreLineAccuracy', () => {
  it('returns 1 when no reference bugs', () => {
    const r = scoreLineAccuracy([], []);
    expect(r.score).toBe(1);
  });

  it('returns 0 when no issues match reference bugs', () => {
    const refs = [{ relevantFile: 'a.ts', relevantLinesStart: 10, relevantLinesEnd: 15 }];
    const r = scoreLineAccuracy([], refs);
    expect(r.score).toBe(0);
  });

  it('returns 1 for exact line match', () => {
    const refs = [{ relevantFile: 'a.ts', relevantLinesStart: 10, relevantLinesEnd: 10 }];
    const issues = [{ file: 'a.ts', line: 10 }];
    const r = scoreLineAccuracy(issues, refs);
    expect(r.score).toBe(1);
  });

  it('scores partial overlap correctly', () => {
    const refs = [{ relevantFile: 'a.ts', relevantLinesStart: 10, relevantLinesEnd: 20 }];
    const issues = [{ file: 'a.ts', line: 15, lineEnd: 25 }];
    const r = scoreLineAccuracy(issues, refs);
    expect(r.score).toBeGreaterThan(0);
    expect(r.score).toBeLessThan(1);
  });

  it('matches issues to correct file', () => {
    const refs = [{ relevantFile: 'a.ts', relevantLinesStart: 10, relevantLinesEnd: 10 }];
    const issues = [
      { file: 'b.ts', line: 10 },
      { file: 'a.ts', line: 10 },
    ];
    const r = scoreLineAccuracy(issues, refs);
    expect(r.score).toBe(1);
  });

  it('merges overlapping reference ranges', () => {
    const refs = [
      { relevantFile: 'a.ts', relevantLinesStart: 10, relevantLinesEnd: 15 },
      { relevantFile: 'a.ts', relevantLinesStart: 14, relevantLinesEnd: 20 },
    ];
    const issues = [{ file: 'a.ts', line: 10, lineEnd: 20 }];
    const r = scoreLineAccuracy(issues, refs);
    expect(r.score).toBe(1);
  });
});
