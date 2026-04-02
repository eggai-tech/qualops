'use strict';

jest.mock('./llm-client', () => ({
  hasJudgeKeys: jest.fn(),
  callJudgeLLM: jest.fn(),
}));
const { hasJudgeKeys, callJudgeLLM } = require('./llm-client');
const { scoreCrb, buildCrbGoldenCommentDetails } = require('./crb-pairwise');
const { parseCrbGoldenCommentDetails } = require('./schemas');

describe('scoreCrb goldenDetails metadata', () => {
  beforeEach(() => {
    jest.resetAllMocks();
  });

  it('returns goldenDetails on crb_recall when no judge keys', async () => {
    hasJudgeKeys.mockReturnValue(false);
    const referenceExpected = [
      { description: 'Bug A', type: 'bug', severity: 'high' },
      { description: 'Bug B', type: 'style', severity: 'low' },
    ];
    const scores = await scoreCrb([], referenceExpected);
    const recall = scores.find((s) => s.name === 'crb_recall');
    expect(recall.metadata).toBeDefined();
    expect(recall.metadata.goldenDetails).toHaveLength(2);
    expect(recall.metadata.goldenDetails[0]).toEqual({
      goldenIndex: 0,
      description: 'Bug A',
      type: 'bug',
      severity: 'high',
      matched: false,
      confidence: 0,
      matchedCandidate: null,
    });
  });

  it('returns goldenDetails when no candidates', async () => {
    hasJudgeKeys.mockReturnValue(true);
    const referenceExpected = [{ description: 'Bug A', type: 'bug', severity: 'high' }];
    const scores = await scoreCrb([], referenceExpected);
    const recall = scores.find((s) => s.name === 'crb_recall');
    expect(recall.metadata.goldenDetails).toHaveLength(1);
    expect(recall.metadata.goldenDetails[0].matched).toBe(false);
  });

  it('returns empty goldenDetails when no goldens', async () => {
    hasJudgeKeys.mockReturnValue(true);
    const scores = await scoreCrb([{ description: 'issue' }], []);
    const recall = scores.find((s) => s.name === 'crb_recall');
    expect(recall.metadata.goldenDetails).toEqual([]);
  });

  it('returns goldenDetails with match data after judging', async () => {
    hasJudgeKeys.mockReturnValue(true);
    callJudgeLLM.mockResolvedValue('{"reasoning":"same","match":true,"confidence":0.95}');
    const referenceExpected = [
      { description: 'Django querysets do not support negative slicing', type: 'bug', severity: 'high' },
    ];
    const issues = [{ description: 'Negative indexing on querysets will fail' }];
    const scores = await scoreCrb(issues, referenceExpected);
    const recall = scores.find((s) => s.name === 'crb_recall');
    expect(recall.metadata.goldenDetails).toHaveLength(1);
    expect(recall.metadata.goldenDetails[0].matched).toBe(true);
    expect(recall.metadata.goldenDetails[0].confidence).toBe(0.95);
    expect(recall.metadata.goldenDetails[0].matchedCandidate).toBe('Negative indexing on querysets will fail');
  });

  it('truncates long descriptions in goldenDetails', async () => {
    hasJudgeKeys.mockReturnValue(false);
    const longDesc = 'A'.repeat(200);
    const referenceExpected = [{ description: longDesc, type: 'bug', severity: 'high' }];
    const scores = await scoreCrb([], referenceExpected);
    const recall = scores.find((s) => s.name === 'crb_recall');
    expect(recall.metadata.goldenDetails[0].description.length).toBeLessThanOrEqual(120);
    expect(recall.metadata.goldenDetails[0].description).toMatch(/…$/);
  });

  it('metadata is only on crb_recall, not on precision or f1', async () => {
    hasJudgeKeys.mockReturnValue(false);
    const referenceExpected = [{ description: 'Bug', type: 'bug', severity: 'high' }];
    const scores = await scoreCrb([], referenceExpected);
    expect(scores.find((s) => s.name === 'crb_precision').metadata).toBeUndefined();
    expect(scores.find((s) => s.name === 'crb_f1').metadata).toBeUndefined();
  });
});

describe('buildCrbGoldenCommentDetails schema conformance', () => {
  it('output passes parseCrbGoldenCommentDetails', () => {
    const referenceExpected = [
      { description: 'Bug A', type: 'bug', severity: 'high' },
      { description: 'Bug B', type: null, severity: null },
    ];
    const details = buildCrbGoldenCommentDetails(referenceExpected, null);
    for (const detail of details) {
      expect(() => parseCrbGoldenCommentDetails(detail)).not.toThrow();
    }
  });

  it('parseCrbGoldenCommentDetails rejects missing required fields', () => {
    expect(() => parseCrbGoldenCommentDetails({ goldenIndex: 0 })).toThrow();
    expect(() => parseCrbGoldenCommentDetails({})).toThrow();
    expect(() => parseCrbGoldenCommentDetails({ goldenIndex: 0, description: 'x' })).toThrow();
  });
});
