import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const cases = [
  { mode: 'valid', status: 0, verdict: 'EDIT ACCEPTED', requests: 1 },
  { mode: 'rollback', status: 2, verdict: 'EDIT REJECTED — RECOVERY VERIFIED', requests: 1 },
  { mode: 'broken-baseline', status: 1, verdict: 'BROKEN BASELINE', requests: 0 },
  { mode: 'missing-key', status: 5, verdict: 'PROVIDER ERROR', requests: 0 },
  { mode: 'http-error', status: 5, verdict: 'PROVIDER ERROR', requests: 1 },
  { mode: 'transport-error', status: 5, verdict: 'PROVIDER ERROR', requests: 1 },
  { mode: 'malformed', status: 4, verdict: 'INVALID PROPOSAL', requests: 1 },
  { mode: 'out-of-scope', status: 4, verdict: 'INVALID PROPOSAL', requests: 1 },
  { mode: 'refusal', status: 4, verdict: 'INVALID PROPOSAL', requests: 1 },
  { mode: 'incomplete', status: 4, verdict: 'INVALID PROPOSAL', requests: 1 },
];
const args = ['--import', './scripts/openai-stub.ts', 'src/cli.ts', 'demo', '--live'];
const fakeKey = 'test-only-agent-guard-key';

for (const scenario of cases) {
  const run = spawnSync(process.execPath, args, {
    encoding: 'utf8',
    timeout: 22_000,
    env: {
      ...process.env,
      NODE_OPTIONS: '',
      AGENT_GUARD_STUB: scenario.mode,
      OPENAI_API_KEY: scenario.mode === 'missing-key' ? '' : fakeKey,
    },
  });
  assert.ifError(run.error);
  assert.ok(!(run.stdout + run.stderr).includes(fakeKey), 'CLI output exposed the synthetic key');
  assert.equal(run.status, scenario.status, run.stderr);
  assert.ok(run.stderr.includes(scenario.verdict), run.stderr);
  assert.match(run.stderr, new RegExp(`^Stub provider requests: ${scenario.requests}$`, 'm'));
  const report = JSON.parse(run.stdout);
  assert.equal(report.scenario, 'live');
  assert.equal(report.changeSource, 'openai');
  assert.equal(report.model, 'gpt-6-luna');
  assert.equal(report.verdict, scenario.verdict);
  const [baseline, withCompany, withoutCompany, recovery] = report.checks;
  assert.equal(baseline.stage, 'baseline');
  if (scenario.mode === 'valid' || scenario.mode === 'rollback') {
    assert.deepEqual(report.proposal.fields.at(-1), { name: 'company', required: false });
    assert.equal(withCompany.stage, 'with-company');
    assert.equal(withoutCompany.stage, 'without-company');
    assert.equal(new Set(report.checks.map(({ reference }: { reference: string }) => reference)).size, report.checks.length);
    if (scenario.mode === 'valid') {
      assert.ok(report.proposal.emailFields.includes('company'));
      assert.equal(report.change, 'kept');
      assert.equal(report.recovery, 'not-attempted');
      assert.match(withCompany.email.body, /\nCompany: Example Studio$/);
      assert.doesNotMatch(withoutCompany.email.body, /\nCompany:/);
      assert.equal(report.checks.length, 3);
    } else {
      assert.deepEqual(report.proposal.emailFields, []);
      assert.equal(report.change, 'restored');
      assert.equal(report.recovery, 'verified');
      assert.equal(withCompany.confirmation.accepted, true);
      assert.equal(withoutCompany.confirmation.accepted, true);
      assert.equal(withCompany.email, null);
      assert.equal(withoutCompany.email, null);
      assert.equal(recovery.stage, 'recovery');
      assert.ok(recovery.email.body.startsWith(`Reference: ${recovery.reference}\n`));
      assert.doesNotMatch(recovery.email.body, /\nCompany:/);
      assert.equal(report.checks.length, 4);
    }
  } else {
    assert.equal(report.change, 'not-applied');
    assert.equal(report.recovery, 'not-attempted');
    assert.equal(report.checks.length, 1);
    assert.ok(!('proposal' in report));
    if (scenario.mode === 'broken-baseline') {
      assert.equal(baseline.email, null);
    } else {
      assert.ok(baseline.email);
      assert.ok(report.failure);
    }
  }
  console.log(`${scenario.mode}: ${report.verdict} (exit ${run.status}, ${scenario.requests} provider requests)`);
}
