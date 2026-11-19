import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { checkNames } from '../src/check-definitions.ts';
import { replayChecks } from './replay.ts';

const cases = [
  { scenario: 'valid', exit: 0, verdict: 'EDIT ACCEPTED', change: 'kept', recovery: 'not-attempted', stages: ['baseline', 'candidate'] },
  { scenario: 'broken-baseline', exit: 1, verdict: 'BROKEN BASELINE', change: 'not-applied', recovery: 'not-attempted', stages: ['baseline'] },
  { scenario: 'broken-edit', exit: 2, verdict: 'EDIT REJECTED — RECOVERY VERIFIED', change: 'restored', recovery: 'verified', stages: ['baseline', 'candidate', 'recovery'] },
  { scenario: 'failed-recovery', exit: 3, verdict: 'EDIT REJECTED — RECOVERY FAILED', change: 'restored', recovery: 'failed', stages: ['baseline', 'candidate', 'recovery'] },
  { scenario: 'invalid', exit: 4, verdict: 'INVALID PROPOSAL', change: 'not-applied', recovery: 'not-attempted', stages: ['baseline'] },
  { scenario: 'suppress-distinct', exit: 2, verdict: 'EDIT REJECTED — RECOVERY VERIFIED', change: 'restored', recovery: 'verified', stages: ['baseline', 'candidate', 'recovery'] },
];

const targets = ['webhook', 'conversion', 'redirect'] as const;
const additionalChecks = checkNames().filter((name) => name !== 'demo' && !targets.some((target) => target === name));
const selected = process.argv[2];
assert.ok(selected === undefined || [...targets, ...additionalChecks].includes(selected), 'Unknown outcome target');

for (const target of targets.filter((target) => selected === undefined || target === selected)) {
  for (const fixture of cases.filter(({ scenario }) => target === 'webhook' || scenario !== 'suppress-distinct')) {
    const args = ['run', '--silent', target];
    if (fixture.scenario !== 'broken-edit') args.push('--', '--scenario', fixture.scenario);
    const run = spawnSync('npm', args, { encoding: 'utf8', timeout: 15_000 });
    assert.ifError(run.error);
    assert.equal(run.status, fixture.exit, run.stderr);
    const report = JSON.parse(run.stdout);
    assert.equal(report.target, target);
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
    if (target === 'redirect') {
      const references = new Set<string>();
      for (const check of report.checks) {
        references.add(check.reference);
        assert.equal(check.expected.status, check.stage === 'candidate' ? 308 : 307);
        assert.equal(new URLSearchParams(check.expected.body).get('reference'), check.reference);
        assert.equal(check.observed.location, '/received');
        const unavailable = (check.stage === 'baseline' && fixture.scenario === 'broken-baseline') ||
          (check.stage === 'recovery' && fixture.scenario === 'failed-recovery');
        assert.equal(check.observed.destinationStatus, unavailable ? 503 : 200);
        const brokenRedirect = check.stage === 'candidate' && fixture.scenario !== 'valid';
        assert.equal(check.observed.status, brokenRedirect ? 301 : check.expected.status);
        assert.equal(check.observed.method, brokenRedirect ? 'GET' : 'POST');
        assert.equal(check.observed.body, brokenRedirect ? '' : check.expected.body);
      }
      assert.equal(references.size, report.checks.length);
    } else if (target === 'conversion') {
      assert.deepEqual(baseline.expected, []);
      assert.deepEqual(baseline.observed, []);
      assert.equal(Boolean(baseline.enquiries[0].email), baseline.passed);
      if (candidate) {
        const [delivered, withheld] = candidate.enquiries;
        assert.ok(delivered.email);
        assert.equal(withheld.confirmation.accepted, true);
        assert.equal(withheld.email, null);
        assert.equal(withheld.failureCode, 'mail-timeout');
        assert.notEqual(delivered.reference, withheld.reference);
        assert.deepEqual(candidate.expected, [delivered.reference]);
        assert.deepEqual(candidate.afterDelivery, [delivered.reference]);
        assert.deepEqual(candidate.observed, fixture.scenario === 'valid' ?
          [delivered.reference] : [delivered.reference, withheld.reference]);
      }
      if (recovery) {
        assert.notEqual(recovery.enquiries[0].reference, baseline.enquiries[0].reference);
        assert.equal(Boolean(recovery.enquiries[0].email), recovery.passed);
        assert.deepEqual(recovery.observed, []);
      }
    } else {
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
    }
    console.log(`${target} ${fixture.scenario}: ${report.verdict} (exit ${run.status})`);
  }
}

for (const row of replayChecks(additionalChecks.filter((name) => selected === undefined || name === selected))) {
  assert.ok(row.matches, `${row.scenario}: expected ${row.expected}, got ${row.actual}, recovered ${row.recovered}`);
  console.log(`${row.scenario}: ${row.actual}`);
}
