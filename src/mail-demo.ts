import { withContactDemo, type DeliveryCheck } from './delivery.ts';
import { isFormDefinition, type FormDefinition } from './form-definition.ts';
import { openAIModel, requestOpenAIProposal } from './openai-proposal.ts';
import { outcomeVerdicts, verdicts } from './outcome-demo.ts';
import { guardedApply } from './guarded-apply.ts';
import type { CheckScenario } from './check-definitions.ts';

export async function runMailDemo(scenario: string, fixture: Pick<CheckScenario, 'proposal' | 'fault'>, live = false) {
  const changeSource = live ? 'openai' : scenario === 'valid' ? 'bundled-valid' : 'bundled-broken';
  const checks: DeliveryCheck[] = [];
  let change: 'not-applied' | 'applied' | 'kept' | 'restored' = 'not-applied';
  let recovery: 'not-attempted' | 'verified' | 'failed' = 'not-attempted';
  let verdict = verdicts.brokenBaseline;
  let failure: string | undefined;
  let liveProposal: FormDefinition | undefined;

  function record(check: DeliveryCheck) {
    checks.push(check);
    const confirmation = check.confirmation?.accepted ? 'form reported success' : 'form did not confirm';
    const delivery = check.email ? 'matching email received' : check.failure;
    console.error(`${check.stage} (${check.reference}): ${confirmation}; ${delivery}`);
    return check.email !== null;
  }

  try {
    await withContactDemo(async (target, checkDelivery) => {
      let edit: { original: FormDefinition; candidate: FormDefinition };
      const result = await guardedApply({
        baseline: async () => {
          target.withholdMail = fixture.fault === 'baseline';
          console.error(`Checking baseline delivery before applying ${changeSource}`);
          if (!record(await checkDelivery('baseline'))) return false;

          let proposal: unknown = fixture.proposal;
          if (live) {
            console.error(`Requesting one proposal from OpenAI (${openAIModel})`);
            const result = await requestOpenAIProposal(target.definition);
            if (result.kind !== 'proposal') {
              verdict = result.kind === 'invalid' ? verdicts.invalid : verdicts.providerError;
              failure = result.reason;
              return false;
            }
            proposal = result.value;
          }
          if (!isFormDefinition(proposal)) {
            verdict = verdicts.invalid;
            failure = 'Proposal is not a valid form definition';
            return false;
          }
          if (live) liveProposal = proposal;
          edit = { original: structuredClone(target.definition), candidate: structuredClone(proposal) };
          return true;
        },
        apply: () => {
          target.definition = edit.candidate;
          change = 'applied';
          console.error(`Applied ${changeSource}`);
        },
        verify: async (stage) => {
          if (stage === 'recovery') return record(await checkDelivery('recovery'));
          let withCompany: boolean;
          let withoutCompany: boolean;
          try {
            withCompany = record(await checkDelivery('with-company', 'Example Studio'));
          } finally {
            withoutCompany = record(await checkDelivery('without-company'));
          }
          return withCompany && withoutCompany;
        },
        rollback: () => {
          target.definition = edit.original;
          change = 'restored';
          target.withholdMail = fixture.fault === 'recovery';
          console.error('Edit rejected. Original form restored. Checking recovery.');
        },
      });

      if (result.outcome !== 'blocked') verdict = outcomeVerdicts[result.outcome];
      if (result.outcome === 'accepted') change = 'kept';
      if (result.outcome === 'recovered') recovery = 'verified';
      if (result.outcome === 'recovery-failed') {
        recovery = 'failed';
        if (result.recoveryFailure.kind === 'threw') throw result.recoveryFailure.cause;
      }
      if (result.outcome !== 'accepted' && result.failure.kind === 'threw') throw result.failure.cause;
    });
  } catch (error) {
    failure = error instanceof Error ? error.message : String(error);
  }

  console.error(failure ? `${verdict.text}: ${failure}` : verdict.text);
  console.log(JSON.stringify({
    scenario, changeSource, model: live ? openAIModel : undefined, proposal: liveProposal,
    change, checks, recovery, verdict: verdict.text, failure,
  }));
  return verdict.exit;
}
