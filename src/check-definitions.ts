import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { verdicts } from './outcome-demo.ts';

const directory = new URL('../checks/', import.meta.url);
const slug = /^[a-z][a-z0-9-]*$/;
const adapters = ['mail', 'webhook', 'conversion', 'redirect'] as const;
type Adapter = (typeof adapters)[number];

export type CheckScenario = {
  proposal: unknown;
  expect: keyof typeof verdicts;
  fault?: 'baseline' | 'recovery';
  defaultOnly?: true;
};

type CheckDefinition = {
  adapter: Adapter;
  default: string;
  scenarios: Map<string, CheckScenario>;
  settings: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isVerdict(value: unknown): value is keyof typeof verdicts {
  return typeof value === 'string' && Object.hasOwn(verdicts, value);
}

export function loadCheck(name: string): CheckDefinition | undefined {
  if (!slug.test(name)) return;
  const path = new URL(`${name}.json`, directory);
  if (!existsSync(path)) return;

  const raw: unknown = JSON.parse(readFileSync(path, 'utf8'));
  const adapter = adapters.find((value) => isRecord(raw) && raw.adapter === value);
  if (!isRecord(raw) || !adapter || typeof raw.default !== 'string' || !isRecord(raw.scenarios) ||
      (raw.proposals !== undefined && !isRecord(raw.proposals))) {
    throw new Error(`Invalid check definition: ${name}`);
  }

  const scenarios = new Map<string, CheckScenario>();
  for (const [id, scenario] of Object.entries(raw.scenarios)) {
    if (!slug.test(id) || !isRecord(scenario) || !Object.hasOwn(scenario, 'proposal') || !isVerdict(scenario.expect) ||
        (scenario.fault !== undefined && scenario.fault !== 'baseline' && scenario.fault !== 'recovery') ||
        (scenario.defaultOnly !== undefined && scenario.defaultOnly !== true)) {
      throw new Error(`Invalid check scenario: ${name}/${id}`);
    }
    let proposal = scenario.proposal;
    if (raw.proposals) {
      if (typeof proposal !== 'string' || !Object.hasOwn(raw.proposals, proposal)) {
        throw new Error(`Unknown proposal: ${name}/${id}`);
      }
      proposal = raw.proposals[proposal];
    }
    scenarios.set(id, { proposal, expect: scenario.expect, fault: scenario.fault, defaultOnly: scenario.defaultOnly });
  }
  if (!scenarios.has(raw.default)) throw new Error(`Unknown default scenario: ${name}/${raw.default}`);
  return { adapter, default: raw.default, scenarios, settings: raw.settings };
}

export function checkNames() {
  return readdirSync(directory)
    .filter((file) => file.endsWith('.json'))
    .map((file) => file.slice(0, -5))
    .sort();
}
