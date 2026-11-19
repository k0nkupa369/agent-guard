import { loadCheck } from './check-definitions.ts';
import { evaluateConversion } from './conversion-demo.ts';
import { runMailDemo } from './mail-demo.ts';
import { runOutcome } from './outcome-demo.ts';
import { evaluateRedirect } from './redirect-demo.ts';
import { evaluateWebhook } from './webhook-demo.ts';

export function showUsage() {
  console.error('Usage: npm run baseline [-- --simulate-no-delivery]');
  console.error('       npm run demo [-- --live | --scenario valid|broken-baseline|failed-recovery]');
  console.error('       node src/cli.ts <check> [--scenario <name>]');
}

export async function runCheck(name: string | undefined, args: string[]) {
  let check;
  try {
    check = name && loadCheck(name);
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    return 64;
  }
  if (!name || !check) {
    showUsage();
    return 64;
  }
  if (name === 'demo' && args.length === 1 && args[0] === '--live') {
    return runMailDemo('live', { proposal: undefined }, true);
  }

  const id = args.length === 0 ? check.default : args[1];
  const scenario = check.scenarios.get(id);
  if (!scenario || (args.length !== 0 && (args.length !== 2 || args[0] !== '--scenario' || scenario.defaultOnly))) {
    const options = [...check.scenarios].filter(([, fixture]) => !fixture.defaultOnly).map(([key]) => key);
    console.error(`Usage: node src/cli.ts ${name} [--scenario ${options.join('|')}]`);
    return 64;
  }

  switch (check.adapter) {
    case 'mail': return runMailDemo(id, scenario);
    case 'conversion': return runOutcome(name, id, () => evaluateConversion(scenario));
    case 'redirect': return runOutcome(name, id, () => evaluateRedirect(scenario, check.settings));
    case 'webhook': return runOutcome(name, id, () => evaluateWebhook(scenario));
  }
}
