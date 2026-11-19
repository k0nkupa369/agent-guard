import { withContactDemo } from './delivery.ts';
import { runCheck, showUsage } from './check-runner.ts';

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

const [command, ...args] = process.argv.slice(2);
if (command === 'baseline' && (args.length === 0 || (args.length === 1 && args[0] === '--simulate-no-delivery'))) {
  process.exitCode = await runBaseline(args.length === 1);
} else if (command === 'baseline') {
  showUsage();
  process.exitCode = 2;
} else {
  process.exitCode = await runCheck(command, args);
}
