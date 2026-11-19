import { spawnSync } from 'node:child_process';
import { checkNames, loadCheck } from '../src/check-definitions.ts';
import { verdicts } from '../src/outcome-demo.ts';

export function replayChecks(names = checkNames()) {
  return names.flatMap((name) => {
    const check = loadCheck(name);
    if (!check) throw new Error(`Unknown check: ${name}`);

    return [...check.scenarios].map(([id, { expect }]) => {
      const args = id === check.default ? [name] : [name, '--scenario', id];
      const run = runCli(args);
      let verdict: unknown;
      let recovery: unknown;
      try {
        const report = JSON.parse(run.stdout);
        verdict = report.verdict;
        recovery = report.recovery;
      } catch {
        verdict = 'No JSON report';
      }

      const expected = verdicts[expect];
      const expectedRecovery = expect === 'recovered' ? 'verified' :
        expect === 'recoveryFailed' ? 'failed' : 'not-attempted';

      return {
        scenario: `${name}/${id}`,
        expected: formatOutcome(expected.text, expected.exit),
        actual: formatOutcome(typeof verdict === 'string' ? verdict : 'Missing verdict', run.status),
        recovered: recovery === 'verified',
        matches: run.status === expected.exit && verdict === expected.text && recovery === expectedRecovery,
      };
    });
  });
}

export function runCli(args: string[]) {
  return spawnSync(process.execPath, ['src/cli.ts', ...args], { encoding: 'utf8', timeout: 15_000 });
}

export function formatOutcome(text: string, exit: number | null) {
  return exit === null ? `${text} (no exit code)` : `${text} (exit ${exit})`;
}
