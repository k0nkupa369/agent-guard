import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';

const cases = [
  { scenario: 'valid', exit: 0, verdict: 'EDIT ACCEPTED', change: 'kept', recovery: 'not-attempted', stages: ['baseline', 'candidate'] },
  { scenario: 'broken-baseline', exit: 1, verdict: 'BROKEN BASELINE', change: 'not-applied', recovery: 'not-attempted', stages: ['baseline'] },
  { scenario: 'broken-edit', exit: 2, verdict: 'EDIT REJECTED — RECOVERY VERIFIED', change: 'restored', recovery: 'verified', stages: ['baseline', 'candidate', 'recovery'] },
  { scenario: 'failed-recovery', exit: 3, verdict: 'EDIT REJECTED — RECOVERY FAILED', change: 'restored', recovery: 'failed', stages: ['baseline', 'candidate', 'recovery'] },
  { scenario: 'invalid', exit: 4, verdict: 'INVALID PROPOSAL', change: 'not-applied', recovery: 'not-attempted', stages: ['baseline'] },
  { scenario: 'suppress-distinct', exit: 2, verdict: 'EDIT REJECTED — RECOVERY VERIFIED', change: 'restored', recovery: 'verified', stages: ['baseline', 'candidate', 'recovery'] },
];

for (const fixture of cases) {
  const args = ['run', '--silent', 'webhook'];
  if (fixture.scenario !== 'broken-edit') args.push('--', '--scenario', fixture.scenario);
  const run = spawnSync('npm', args, { encoding: 'utf8', timeout: 15_000 });
  assert.ifError(run.error);
  assert.equal(run.status, fixture.exit, run.stderr);
  const report = JSON.parse(run.stdout);
  assert.equal(report.target, 'webhook');
  assert.equal(report.scenario, fixture.scenario);
  assert.equal(report.verdict, fixture.verdict);
  assert.ok(run.stderr.includes(fixture.verdict));
  assert.equal(report.change, fixture.change);
  assert.equal(report.recovery, fixture.recovery);
  assert.equal(report.applications, fixture.change === 'not-applied' ? 0 : 1);
  assert.deepEqual(report.checks.map(({ stage }: { stage: string }) => stage), fixture.stages);
  const [baseline, candidate, recovery] = report.checks;
  assert.equal(baseline.passed, fixture.scenario !== 'broken-baseline');
  if (candidate) assert.equal(candidate.passed, fixture.scenario === 'valid');
  if (recovery) assert.equal(recovery.passed, fixture.recovery === 'verified');
  if (candidate) {
    for (const probe of candidate.probes) {
      const [first, second] = probe.expected;
      assert.deepEqual(probe.acknowledgements, [204, 204, 204]);
      const observed = fixture.scenario === 'valid' ? [first, second] :
        fixture.scenario === 'suppress-distinct' ? [first] : [first, first, second];
      assert.deepEqual(probe.observed, observed);
      assert.deepEqual(probe.observedAfterEach, [[first], observed.slice(0, fixture.scenario === 'valid' ||
        fixture.scenario === 'suppress-distinct' ? 1 : 2), observed]);
    }
    assert.deepEqual(candidate.probes.map(({ type }: { type: string }) => type), ['lead.created', 'lead.qualified']);
  }
  for (const stage of [baseline, recovery].filter(Boolean)) {
    const probe = stage.probes[0];
    assert.deepEqual(probe.observedAfterEach, stage.passed ?
      [[probe.expected[0]], [probe.expected[0]], probe.expected] : [[], [], []]);
  }
  if (recovery) {
    assert.equal(recovery.unsupportedStatus, 422);
    assert.equal(recovery.unsupportedWrites, 0);
    assert.notDeepEqual(recovery.probes[0].expected, baseline.probes[0].expected);
  }
  console.log(`webhook ${fixture.scenario}: ${report.verdict} (exit ${run.status})`);
}
