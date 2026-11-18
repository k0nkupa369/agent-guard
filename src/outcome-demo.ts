export const verdicts = {
  accepted: { exit: 0, text: 'EDIT ACCEPTED' },
  brokenBaseline: { exit: 1, text: 'BROKEN BASELINE' },
  recovered: { exit: 2, text: 'EDIT REJECTED — RECOVERY VERIFIED' },
  recoveryFailed: { exit: 3, text: 'EDIT REJECTED — RECOVERY FAILED' },
  invalid: { exit: 4, text: 'INVALID PROPOSAL' },
  providerError: { exit: 5, text: 'PROVIDER ERROR' },
};

const scenarios = ['valid', 'broken-baseline', 'broken-edit', 'failed-recovery', 'invalid'] as const;
export type OutcomeScenario = (typeof scenarios)[number];
export type OutcomeStage = 'baseline' | 'candidate' | 'recovery';

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

  if (!await observe('baseline')) return report(verdicts.brokenBaseline);
  if (!target.validate(target.proposal)) return report(verdicts.invalid);
  proposal = target.proposal;
  const original = structuredClone(target.definition);
  target.definition = structuredClone(proposal);
  applications++;
  if (await observe('candidate')) {
    change = 'kept';
    return report(verdicts.accepted);
  }
  target.definition = original;
  change = 'restored';
  console.error('Edit rejected. Original definition restored. Checking recovery.');
  recovery = await observe('recovery') ? 'verified' : 'failed';
  return report(recovery === 'verified' ? verdicts.recovered : verdicts.recoveryFailed);
}

export async function runOutcome<Extra extends string = never>(
  name: string,
  args: string[],
  launch: (scenario: OutcomeScenario | Extra) => ReturnType<typeof guardOutcome>,
  extraScenario?: Extra,
) {
  const options = extraScenario ? [...scenarios, extraScenario] : scenarios;
  const scenario = args.length === 0 ? 'broken-edit' : options.find((option) => option === args[1]);
  if (!scenario || (args.length !== 0 && (args.length !== 2 || args[0] !== '--scenario'))) {
    console.error(`Usage: npm run ${name} [-- --scenario ${options.join('|')}]`);
    return 64;
  }
  let result;
  try {
    result = await launch(scenario);
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
