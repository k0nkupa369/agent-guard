import { randomUUID } from 'node:crypto';
import { readRequestBody, withLoopbackHttp } from './loopback-http.ts';
import { guardOutcome, type OutcomeStage } from './outcome-demo.ts';
import type { CheckScenario } from './check-definitions.ts';

type Definition = 307 | 308 | 301;

function preservesMethod(value: unknown): value is 307 | 308 {
  return value === 307 || value === 308;
}
const destinationPath = '/received';

export async function evaluateRedirect(scenario: CheckScenario, settings: unknown) {
  if (typeof settings !== 'object' || settings === null ||
      !('baselineStatus' in settings) || !preservesMethod(settings.baselineStatus) ||
      !('candidateStatus' in settings) || !preservesMethod(settings.candidateStatus)) {
    throw new Error('Redirect settings require baselineStatus and candidateStatus of 307 or 308');
  }
  const { baselineStatus, candidateStatus } = settings;
  let destinationUnavailable = false;
  const target = {
    definition: baselineStatus as Definition,
    proposal: scenario.proposal,
  };

  return withLoopbackHttp(async (request, response) => {
    if (request.url === '/submit' && request.method === 'POST') {
      await readRequestBody(request);
      response.writeHead(target.definition, { Location: destinationPath }).end();
      return;
    }
    if (request.url === destinationPath) {
      const body = await readRequestBody(request);
      response.writeHead(destinationUnavailable ? 503 : 200, { 'Content-Type': 'application/json' }).end(JSON.stringify({
        method: request.method, body,
      }));
      return;
    }
    response.writeHead(404).end();
  }, async (origin) => {
    async function check(stage: OutcomeStage) {
      destinationUnavailable = (stage === 'baseline' && scenario.fault === 'baseline') ||
        (stage === 'recovery' && scenario.fault === 'recovery');
      const reference = randomUUID();
      const body = new URLSearchParams({ reference, enquiry: 'A synthetic form submission' });
      const expected = { status: stage === 'candidate' ? candidateStatus : baselineStatus, method: 'POST', body: body.toString() };
      const request = { method: 'POST', body, signal: AbortSignal.timeout(1500) };
      const initial = await fetch(`${origin}/submit`, { ...request, redirect: 'manual' });
      const location = initial.headers.get('location');
      await initial.body?.cancel();
      const redirect = { status: initial.status, location };
      if (location !== destinationPath) {
        return { reference, expected, observed: redirect, passed: false, failure: 'Unexpected redirect destination' };
      }

      // Read the redirect separately so the next request can use Fetch's actual follow behavior.
      const destination = await fetch(`${origin}/submit`, { ...request, redirect: 'follow' });
      const destinationStatus = destination.status;
      const received = await destination.json().catch(() => null);
      if (!received || typeof received.method !== 'string' || typeof received.body !== 'string') {
        return {
          reference, expected, observed: { ...redirect, destinationStatus },
          passed: false, failure: 'Destination did not return request evidence',
        };
      }
      const observed = {
        ...redirect, destinationStatus, method: received.method, body: received.body,
      };
      const passed = destination.url === `${origin}${destinationPath}` && destination.status === 200 &&
        received.method === expected.method && received.body === expected.body && redirect.status === expected.status;
      return { reference, expected, observed, passed };
    }

    return guardOutcome(Object.assign(target, {
      validate: (value: unknown): value is Definition => value === candidateStatus || value === 301,
      check,
    }));
  });
}
