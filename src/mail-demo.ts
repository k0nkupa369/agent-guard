import { withContactDemo, type DeliveryCheck } from './delivery.ts';
import { isFormDefinition, type FormDefinition } from './form-definition.ts';
import { openAIModel, requestOpenAIProposal } from './openai-proposal.ts';
import { verdicts } from './outcome-demo.ts';
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
      target.withholdMail = fixture.fault === 'baseline';
      console.error(`Checking baseline delivery before applying ${changeSource}`);
      if (!record(await checkDelivery('baseline'))) return;

      let proposal: unknown;
      if (changeSource === 'openai') {
        console.error(`Requesting one proposal from OpenAI (${openAIModel})`);
        const result = await requestOpenAIProposal(target.definition);
        if (result.kind !== 'proposal') {
          verdict = result.kind === 'invalid' ? verdicts.invalid : verdicts.providerError;
          failure = result.reason;
          return;
        }
        proposal = result.value;
      } else {
        proposal = fixture.proposal;
      }
      if (!isFormDefinition(proposal)) {
        verdict = verdicts.invalid;
        failure = 'Proposal is not a valid form definition';
        return;
      }
      if (live) liveProposal = proposal;

      const original = structuredClone(target.definition);
      target.definition = structuredClone(proposal);
      change = 'applied';
      console.error(`Applied ${changeSource}`);
      const withCompany = record(await checkDelivery('with-company', 'Example Studio'));
      const withoutCompany = record(await checkDelivery('without-company'));
      if (withCompany && withoutCompany) {
        change = 'kept';
        verdict = verdicts.accepted;
        return;
      }

      target.definition = original;
      change = 'restored';
      target.withholdMail = fixture.fault === 'recovery';
      console.error('Edit rejected. Original form restored. Checking recovery.');
      recovery = record(await checkDelivery('recovery')) ? 'verified' : 'failed';
      verdict = recovery === 'verified' ? verdicts.recovered : verdicts.recoveryFailed;
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
