import { randomUUID } from 'node:crypto';
import { readRequestBody, withLoopbackHttp } from './loopback-http.ts';
import { guardOutcome, runOutcome, type OutcomeScenario, type OutcomeStage } from './outcome-demo.ts';

type Definition = 307 | 308 | 301;
const destinationPath = '/received';

async function evaluateRedirect(scenario: OutcomeScenario) {
  let destinationUnavailable = false;
  const target = {
    definition: 307 as Definition,
    proposal: scenario === 'valid' ? 308 : scenario === 'invalid' ? 302 : 301,
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
      destinationUnavailable = (stage === 'baseline' && scenario === 'broken-baseline') ||
        (stage === 'recovery' && scenario === 'failed-recovery');
      const reference = randomUUID();
      const body = new URLSearchParams({ reference, enquiry: 'A synthetic form submission' });
      const expected = { status: stage === 'candidate' ? 308 : 307, method: 'POST', body: body.toString() };
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
      validate: (value: unknown): value is Definition => value === 308 || value === 301,
      check,
    }));
  });
}

export function runRedirectDemo(args: string[]) {
  return runOutcome('redirect', args, evaluateRedirect);
}
