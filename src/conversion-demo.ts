import { withContactDemo } from './delivery.ts';
import { readRequestBody, withLoopbackHttp } from './loopback-http.ts';
import { guardOutcome, runOutcome, type OutcomeScenario, type OutcomeStage } from './outcome-demo.ts';

type Definition = 'off' | 'delivered' | 'confirmation';

async function evaluateConversions(scenario: OutcomeScenario) {
  const collected: string[] = [];
  const target = {
    definition: 'off' as Definition,
    proposal: scenario === 'valid' ? 'delivered' : scenario === 'invalid' ? 'unknown' : 'confirmation',
  };

  return withLoopbackHttp(async (request, response) => {
    if (request.url !== '/conversions') {
      response.writeHead(404).end();
      return;
    }
    if (request.method === 'GET') {
      response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(collected));
      return;
    }
    if (request.method !== 'POST') {
      response.writeHead(405).end();
      return;
    }
    const reference = await readRequestBody(request);
    if (!/^[a-f0-9-]{36}$/.test(reference)) {
      response.writeHead(400).end();
      return;
    }
    collected.push(reference);
    response.writeHead(204).end();
  }, (origin) => withContactDemo(async (contact, checkDelivery) => {
    const url = `${origin}/conversions`;
    contact.recordConversion = async (reference, delivered) => {
      if (target.definition === 'off' || (target.definition === 'delivered' && !delivered)) return;
      const response = await fetch(url, {
        method: 'POST', body: reference, redirect: 'error', signal: AbortSignal.timeout(1500),
      });
      if (response.status !== 204) throw new Error('Could not record the conversion');
    };

    async function conversions(): Promise<string[]> {
      const response = await fetch(url, { redirect: 'error', signal: AbortSignal.timeout(1500) });
      if (!response.ok) throw new Error('Could not read the synthetic conversions');
      return response.json();
    }

    async function check(stage: OutcomeStage) {
      const before = (await conversions()).length;
      contact.withholdMail = (stage === 'baseline' && scenario === 'broken-baseline') ||
        (stage === 'recovery' && scenario === 'failed-recovery');
      const delivered = await checkDelivery('baseline');
      const enquiries = [delivered];
      const afterDelivery = (await conversions()).slice(before);
      if (stage === 'candidate') {
        contact.withholdMail = true;
        enquiries.push(await checkDelivery('baseline'));
      }
      const withheld = enquiries[1];
      const expected = stage === 'candidate' ? [delivered.reference] : [];
      const observed = withheld ? (await conversions()).slice(before) : afterDelivery;
      const matches = (references: string[]) => references.length === expected.length &&
        references.every((reference, index) => reference === expected[index]);
      const passed = delivered.email !== null && (!withheld || (
        withheld.confirmation?.accepted === true && withheld.email === null &&
        withheld.failureCode === 'mail-timeout'
      )) && matches(afterDelivery) && matches(observed);
      return {
        passed: Boolean(passed),
        enquiries: enquiries.map(({ stage: _stage, ...enquiry }) => enquiry),
        expected, afterDelivery, observed,
      };
    }

    return guardOutcome(Object.assign(target, {
      validate: (value: unknown): value is Definition => value === 'delivered' || value === 'confirmation',
      check,
    }));
  }));
}

export function runConversionDemo(args: string[]) {
  return runOutcome('conversion', args, evaluateConversions);
}
