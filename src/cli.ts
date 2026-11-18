import { withContactDemo, type DeliveryCheck } from './delivery.ts';
import { bundledProposals, isFormDefinition, type FormDefinition } from './form-definition.ts';
import { openAIModel, requestOpenAIProposal } from './openai-proposal.ts';
import { verdicts } from './outcome-demo.ts';
import { runWebhookDemo } from './webhook-demo.ts';

async function runBaseline(simulateNoDelivery: boolean) {
  try {
    await withContactDemo(async (target, checkDelivery) => {
      if (simulateNoDelivery) {
        const older = await checkDelivery('older');
        if (!older.email) throw new Error(older.failure);
        console.log(`Older enquiry already in inbox (${older.reference})`);
        target.withholdMail = true;
      }
      const baseline = await checkDelivery('baseline');
      if (baseline.confirmation?.accepted) console.log(`Form reported success (${baseline.reference})`);
      if (!baseline.email) throw new Error(baseline.failure);
      console.log(`VERIFIED DELIVERY: matching email received (${baseline.reference})`);
    });
  } catch (error) {
    console.error('BROKEN BASELINE:', error instanceof Error ? error.message : error);
    return 1;
  }
  return 0;
}

const demoScenarios = ['valid', 'broken-baseline', 'failed-recovery'] as const;
type Scenario = 'broken-edit' | 'live' | (typeof demoScenarios)[number];

async function runDemo(scenario: Scenario) {
  const live = scenario === 'live';
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
      target.withholdMail = scenario === 'broken-baseline';
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
        proposal = bundledProposals[changeSource];
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
      target.withholdMail = scenario === 'failed-recovery';
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

const [command, ...args] = process.argv.slice(2);
const selectedScenario = demoScenarios.find((scenario) => scenario === args[1]);
if (command === 'baseline' && (args.length === 0 || (args.length === 1 && args[0] === '--simulate-no-delivery'))) {
  process.exitCode = await runBaseline(args.length === 1);
} else if (command === 'demo' && args.length === 0) {
  process.exitCode = await runDemo('broken-edit');
} else if (command === 'demo' && args.length === 1 && args[0] === '--live') {
  process.exitCode = await runDemo('live');
} else if (command === 'demo' && args.length === 2 && args[0] === '--scenario' && selectedScenario) {
  process.exitCode = await runDemo(selectedScenario);
} else if (command === 'webhook') {
  process.exitCode = await runWebhookDemo(args);
} else {
  console.error('Usage: npm run baseline [-- --simulate-no-delivery]');
  console.error(`       npm run demo [-- --live | --scenario ${demoScenarios.join('|')}]`);
  console.error('       npm run webhook [-- --scenario ...]');
  process.exitCode = command === 'baseline' ? 2 : 64;
}
