export type VerifyStage = 'candidate' | 'recovery';

export type GuardedApplyOptions = {
  baseline: () => boolean | Promise<boolean>;
  apply: () => void | Promise<void>;
  verify: (stage: VerifyStage) => boolean | Promise<boolean>;
  rollback: () => void | Promise<void>;
};

type CallbackError<Stage> = { stage: Stage; kind: 'threw'; cause: unknown };
type CheckFailure<Stage> = { stage: Stage; kind: 'check-failed' } | CallbackError<Stage>;
type EditFailure = CallbackError<'apply'> | CheckFailure<'candidate'>;

export type GuardedApplyResult =
  | { outcome: 'blocked'; failure: CheckFailure<'baseline'> }
  | { outcome: 'accepted' }
  | { outcome: 'recovered'; failure: EditFailure }
  | {
      outcome: 'recovery-failed';
      failure: EditFailure;
      recoveryFailure: CallbackError<'rollback'> | CheckFailure<'recovery'>;
    };

async function check<Stage extends 'baseline' | VerifyStage>(
  stage: Stage, probe: GuardedApplyOptions['baseline'],
): Promise<CheckFailure<Stage> | undefined> {
  try {
    if (await probe() !== true) return { stage, kind: 'check-failed' };
  } catch (cause) {
    return { stage, kind: 'threw', cause };
  }
}

export async function guardedApply({
  baseline, apply, verify, rollback,
}: GuardedApplyOptions): Promise<GuardedApplyResult> {
  const baselineFailure = await check('baseline', baseline);
  if (baselineFailure) return { outcome: 'blocked', failure: baselineFailure };

  let failure: EditFailure | undefined;
  try {
    await apply();
  } catch (cause) {
    failure = { stage: 'apply', kind: 'threw', cause };
  }
  failure ??= await check('candidate', () => verify('candidate'));
  if (!failure) return { outcome: 'accepted' };

  try {
    await rollback();
  } catch (cause) {
    return { outcome: 'recovery-failed', failure, recoveryFailure: { stage: 'rollback', kind: 'threw', cause } };
  }

  const recoveryFailure = await check('recovery', () => verify('recovery'));
  if (recoveryFailure) return { outcome: 'recovery-failed', failure, recoveryFailure };
  return { outcome: 'recovered', failure };
}
