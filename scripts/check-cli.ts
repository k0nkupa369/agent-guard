import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const cases = [
  {
    args: ['run', '--silent', 'demo', '--', '--scenario', 'valid'],
    status: 0,
    verdict: 'EDIT ACCEPTED',
    change: 'kept',
    recovery: 'not-attempted',
    checks: { baseline: true, 'with-company': true, 'without-company': true },
  },
  {
    args: ['run', '--silent', 'demo', '--', '--scenario', 'broken-baseline'],
    status: 1,
    verdict: 'BROKEN BASELINE',
    change: 'not-applied',
    recovery: 'not-attempted',
    checks: { baseline: false },
  },
  {
    args: ['run', 'demo'],
    status: 2,
    verdict: 'EDIT REJECTED — RECOVERY VERIFIED',
    change: 'restored',
    recovery: 'verified',
    checks: { baseline: true, 'with-company': false, 'without-company': false, recovery: true },
  },
  {
    args: ['run', '--silent', 'demo', '--', '--scenario', 'failed-recovery'],
    status: 3,
    verdict: 'EDIT REJECTED — RECOVERY FAILED',
    change: 'restored',
    recovery: 'failed',
    checks: { baseline: true, 'with-company': false, 'without-company': false, recovery: false },
  },
  { args: ['run', 'baseline'], status: 0, verdict: 'VERIFIED DELIVERY' },
  { args: ['run', 'baseline', '--', '--simulate-no-delivery'], status: 1, verdict: 'BROKEN BASELINE' },
];

for (const scenario of cases) {
  const command = `npm ${scenario.args.join(' ')}`;
  const run = spawnSync('npm', scenario.args, { encoding: 'utf8', timeout: 12_000 });
  const output = run.stdout + run.stderr;
  console.log(`$ ${command}`);
  assert.ifError(run.error);
  assert.equal(run.status, scenario.status, output);
  assert.ok((scenario.checks ? run.stderr : output).includes(scenario.verdict), output);

  if (scenario.checks) {
    // npm adds a script banner to stdout unless invoked with --silent.
    const json = scenario.args.includes('--silent') ? run.stdout : run.stdout.trim().split('\n').at(-1)!;
    const report = JSON.parse(json);
    assert.equal(report.verdict, scenario.verdict);
    assert.equal(report.changeSource, scenario.change === 'kept' ? 'bundled-valid' : 'bundled-broken');
    assert.ok(run.stderr.includes(report.changeSource), run.stderr);
    assert.equal(report.change, scenario.change);
    assert.equal(report.recovery, scenario.recovery);
    assert.deepEqual(report.checks.map(({ stage }: { stage: string }) => stage), Object.keys(scenario.checks));
    const references = new Set<string>();
    for (const check of report.checks) {
      assert.match(check.reference, /^[\da-f-]{36}$/);
      assert.ok(!references.has(check.reference));
      references.add(check.reference);
      assert.deepEqual(check.form, { status: 200, matches: true });
      assert.deepEqual(check.confirmation, { status: 200, accepted: true });
      if (!scenario.checks[check.stage as keyof typeof scenario.checks]) {
        assert.equal(check.email, null);
        assert.match(check.failure, /No matching email within 1500 ms/);
      } else {
        assert.equal(check.email.subject, 'Contact enquiry');
        assert.deepEqual(check.email.recipients, ['enquiries@example.test']);
        const expected = `Reference: ${check.reference}\nName: Casey Example\nEmail: casey@example.test\nMessage: Could you send me a sample catalogue?`;
        assert.equal(check.email.body, check.stage === 'with-company' ? `${expected}\nCompany: Example Studio` : expected);
      }
    }
  } else {
    const current = output.match(/Form reported success \(([^)]+)\)/)?.[1];
    assert.match(current ?? '', /^[\da-f-]{36}$/);
    if (scenario.status === 1) {
      const older = output.match(/Older enquiry already in inbox \(([^)]+)\)/)?.[1];
      assert.match(older ?? '', /^[\da-f-]{36}$/);
      assert.notEqual(older, current);
      assert.ok(output.includes(`No matching email within 1500 ms (${current})`), output);
      assert.doesNotMatch(output, /VERIFIED DELIVERY/);
    } else {
      assert.ok(output.includes(`matching email received (${current})`), output);
    }
  }
  console.log(`${scenario.verdict} (exit ${run.status})`);
}
