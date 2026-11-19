import { writeFileSync } from 'node:fs';
import live from '../docs/live-run.json' with { type: 'json' };
import { formatOutcome, replayChecks, runCli } from './replay.ts';

const rows = [
  ...[
    { scenario: 'baseline/default', args: ['baseline'], outcome: 'VERIFIED DELIVERY', exit: 0 },
    { scenario: 'baseline/simulate-no-delivery', args: ['baseline', '--simulate-no-delivery'], outcome: 'BROKEN BASELINE', exit: 1 },
  ].map(({ scenario, args, outcome, exit }) => {
    const run = runCli(args);
    const verdict = /^(VERIFIED DELIVERY|BROKEN BASELINE):/m.exec(run.stdout + '\n' + run.stderr)?.[1];
    return {
      scenario,
      expected: formatOutcome(outcome, exit),
      actual: formatOutcome(verdict ?? 'Missing verdict', run.status),
      recovered: false,
      matches: verdict === outcome && run.status === exit,
    };
  }),
  ...replayChecks(),
];

const report = [
  '# Agent Guard eval',
  '',
  'Run `npm run eval` to replay the bundled scenarios and regenerate this report.',
  '',
  '| Scenario | Expected outcome | Actual outcome | Recovered |',
  '| --- | --- | --- | --- |',
  ...rows.map(({ scenario, expected, actual, recovered }) =>
    `| ${scenario} | ${expected} | ${actual} | ${recovered ? 'yes' : 'no'} |`),
  '',
  '## Recorded live run',
  '',
  `The saved run used \`${live.model}\` and reported **${live.verdict}**. Eval reads the [saved report](live-run.json) without calling the provider.`,
  '',
  '| Stage | Reference | Matching email |',
  '| --- | --- | --- |',
  ...live.checks.map(({ stage, reference, email }) => `| ${stage} | \`${reference}\` | ${email ? 'yes' : 'no'} |`),
  '',
].join('\n');

writeFileSync(new URL('../docs/eval.md', import.meta.url), report);
process.stdout.write(report);
const failures = rows.filter(({ matches }) => !matches);
if (failures.length > 0) {
  console.error(`Unexpected results for ${failures.map(({ scenario }) => scenario).join(', ')}`);
  process.exitCode = 1;
}
