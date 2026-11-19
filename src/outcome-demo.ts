import { guardedApply, type VerifyStage } from './guarded-apply.ts';

export const verdicts = {
  accepted: { exit: 0, text: 'EDIT ACCEPTED' },
  brokenBaseline: { exit: 1, text: 'BROKEN BASELINE' },
  recovered: { exit: 2, text: 'EDIT REJECTED — RECOVERY VERIFIED' },
  recoveryFailed: { exit: 3, text: 'EDIT REJECTED — RECOVERY FAILED' },
  invalid: { exit: 4, text: 'INVALID PROPOSAL' },
  providerError: { exit: 5, text: 'PROVIDER ERROR' },
};

export const outcomeVerdicts = {
  blocked: verdicts.brokenBaseline,
  accepted: verdicts.accepted,
  recovered: verdicts.recovered,
  'recovery-failed': verdicts.recoveryFailed,
};

export type OutcomeStage = 'baseline' | VerifyStage;

type OutcomeCheck = { passed: boolean; failure?: string };
type OutcomeTarget<Definition> = {
  definition: Definition;
  proposal: unknown;
  validate: (proposal: unknown) => proposal is Definition;
  check: (stage: OutcomeStage) => Promise<OutcomeCheck>;
};

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : String(error);
}

export async function guardOutcome<Definition>(target: OutcomeTarget<Definition>) {
  const checks: (OutcomeCheck & { stage: OutcomeStage })[] = [];
  let change = 'not-applied';
  let recovery = 'not-attempted';
  let applications = 0;
  let proposal: Definition | undefined;
  let edit: { original: Definition; candidate: Definition };
  let invalid = false;
  const report = (verdict: (typeof verdicts)[keyof typeof verdicts]) => ({
    ...verdict, change, recovery, applications, proposal, checks,
  });

  async function observe(stage: OutcomeStage) {
    let check: OutcomeCheck;
    try {
      check = await target.check(stage);
    } catch (error) {
      check = { passed: false, failure: errorMessage(error) };
    }
    checks.push({ ...check, stage });
    console.error(`${stage}: ${check.passed ? 'verified' : check.failure ?? 'outcome mismatch'}`);
    return check.passed;
  }

  const result = await guardedApply({
    baseline: async () => {
      if (!await observe('baseline')) return false;
      if (!target.validate(target.proposal)) {
        invalid = true;
        return false;
      }
      proposal = target.proposal;
      edit = { original: structuredClone(target.definition), candidate: structuredClone(proposal) };
      return true;
    },
    apply: () => {
      target.definition = edit.candidate;
      change = 'applied';
      applications++;
    },
    verify: observe,
    rollback: () => {
      target.definition = edit.original;
      change = 'restored';
      console.error('Edit rejected. Original definition restored. Checking recovery.');
    },
  });

  if (result.outcome === 'accepted') change = 'kept';
  if (result.outcome === 'recovered') recovery = 'verified';
  if (result.outcome === 'recovery-failed') recovery = 'failed';
  if (result.outcome === 'blocked' && result.failure.kind === 'threw') throw result.failure.cause;
  return report(invalid ? verdicts.invalid : outcomeVerdicts[result.outcome]);
}

export async function runOutcome(name: string, scenario: string, launch: () => ReturnType<typeof guardOutcome>) {
  let result;
  try {
    result = await launch();
  } catch (error) {
    result = {
      ...verdicts.brokenBaseline, change: 'not-applied', recovery: 'not-attempted',
      applications: 0, checks: [], failure: errorMessage(error),
    };
  }
  const { text: verdict, exit, ...report } = result;
  console.error(verdict);
  console.log(JSON.stringify({ target: name, scenario, verdict, ...report }));
  return exit;
}
