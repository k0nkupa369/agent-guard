import { randomUUID } from 'node:crypto';
import { readRequestBody, withLoopbackHttp } from './loopback-http.ts';
import { guardOutcome, type OutcomeStage } from './outcome-demo.ts';
import type { CheckScenario } from './check-definitions.ts';

const eventTypes = ['lead.created', 'lead.qualified'] as const;
const keys = ['eventId', 'attemptId', 'leadId'] as const;
type EventType = (typeof eventTypes)[number];
type Definition = { types: EventType[]; key: (typeof keys)[number] };
const original: Definition = { types: ['lead.created'], key: 'eventId' };

function isDefinition(value: unknown): value is Definition {
  if (typeof value !== 'object' || value === null || Object.keys(value).length !== 2) return false;
  const { types, key } = value as Partial<Definition>;
  return Array.isArray(types) && types.length === 2 && new Set(types).size === 2 &&
    eventTypes.every((type) => types.includes(type)) && key !== undefined && keys.includes(key);
}

export async function evaluateWebhook(scenario: CheckScenario) {
  const ledger: string[] = [];
  const seen = new Set<string>();
  let withholdEntries = false;
  const target = {
    definition: structuredClone(original),
    proposal: scenario.proposal,
  };

  return withLoopbackHttp(async (request, response) => {
    if (request.method === 'GET' && request.url === '/ledger') {
      response.writeHead(200, { 'Content-Type': 'application/json' }).end(JSON.stringify(ledger));
      return;
    }
    if (request.method !== 'POST' || request.url !== '/webhook') {
      response.writeHead(404).end();
      return;
    }
    const event = JSON.parse(await readRequestBody(request));
    if (!event || typeof event !== 'object' || typeof event.type !== 'string' ||
        !keys.every((key) => typeof event[key] === 'string' && /^[a-f0-9-]{36}$/.test(event[key]))) {
      response.writeHead(400).end();
      return;
    }
    if (!target.definition.types.includes(event.type)) {
      response.writeHead(422).end();
      return;
    }
    const key = event[target.definition.key];
    if (!withholdEntries && !seen.has(key)) {
      seen.add(key);
      ledger.push(event.eventId);
    }
    response.writeHead(204).end();
  }, async (origin) => {
    async function entries(): Promise<string[]> {
      const response = await fetch(`${origin}/ledger`, { signal: AbortSignal.timeout(1500) });
      if (!response.ok) throw new Error('Could not read the synthetic ledger');
      return response.json();
    }

    async function send(type: EventType, eventId: string, leadId: string) {
      const response = await fetch(`${origin}/webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ type, eventId, leadId, attemptId: randomUUID() }),
        signal: AbortSignal.timeout(1500),
      });
      return response.status;
    }

    async function probe(type: EventType) {
      const before = (await entries()).length;
      const expected = [randomUUID(), randomUUID()];
      const leadId = randomUUID();
      const acknowledgements = [];
      const observedAfterEach = [];
      for (const eventId of [expected[0], expected[0], expected[1]]) {
        acknowledgements.push(await send(type, eventId, leadId));
        observedAfterEach.push((await entries()).slice(before));
      }
      const observed = observedAfterEach[2];
      const passed = acknowledgements.every((status) => status === 204) &&
        observedAfterEach.every((rows, index) =>
          rows.length === (index < 2 ? 1 : 2) && rows.every((id, offset) => id === expected[offset]));
      return { type, expected, observed, observedAfterEach, acknowledgements, passed };
    }

    async function check(stage: OutcomeStage) {
      withholdEntries = (stage === 'baseline' && scenario.fault === 'baseline') ||
        (stage === 'recovery' && scenario.fault === 'recovery');
      const probes = [await probe('lead.created')];
      if (stage === 'candidate') probes.push(await probe('lead.qualified'));
      let unsupportedStatus: number | undefined;
      let unsupportedWrites: number | undefined;
      if (stage !== 'candidate') {
        const before = (await entries()).length;
        unsupportedStatus = await send('lead.qualified', randomUUID(), randomUUID());
        unsupportedWrites = (await entries()).length - before;
      }
      return {
        probes, unsupportedStatus, unsupportedWrites,
        passed: probes.every((probe) => probe.passed) &&
          (stage === 'candidate' || (unsupportedStatus === 422 && unsupportedWrites === 0)),
      };
    }

    return guardOutcome(Object.assign(target, { validate: isDefinition, check }));
  });
}
