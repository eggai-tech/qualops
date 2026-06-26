import { buildBashToolDescription } from '../../../../../../../src/stages/review/agentic/tools/bash/description';
import { evaluatePolicy } from '../../../../../../../src/stages/review/agentic/tools/bash/policy';

describe('buildBashToolDescription', () => {
  test('uses the given root, not a hardcoded /workspace', () => {
    const root = '/home/runner/work/configurable-agent/configurable-agent';
    const desc = buildBashToolDescription(root);
    expect(desc).toContain(`${root}/src`);
    expect(desc).not.toContain('/workspace');
  });

  test('trailing slashes never produce double slashes', () => {
    const desc = buildBashToolDescription('/srv/checkout/');
    expect(desc).toContain('/srv/checkout/src');
    expect(desc).not.toContain('//');
  });

  // The regression guard: the bug was that the description's paths and the policy's
  // enforced root disagreed, so every command was denied with path-outside-workspace.
  // Assert they can't drift — the example paths in the description must pass the policy
  // under the same root.
  test.each(['/workspace/pr', '/home/runner/work/repo/repo'])(
    'example paths pass the policy for root %s',
    (root) => {
      expect(evaluatePolicy(`cat ${root}/src/auth.ts`, { workspaceRoot: root })).toEqual({
        deny: false,
      });
    },
  );
});
