import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { Server } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { contactPath, createContactSite } from './contact-site.ts';
import { createInbox } from './inbox.ts';

const host = '127.0.0.1';
const deliveryWaitMs = 1_500;
const enquiry = {
  name: 'Casey Example',
  email: 'casey@example.test',
  message: 'Could you send me a sample catalogue?',
};

function portOf(server: Server) {
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Local server has no TCP address');
  return address.port;
}

async function submit(url: string, reference: string, signal: AbortSignal) {
  const response = await fetch(url, {
    method: 'POST',
    body: new URLSearchParams({ ...enquiry, reference }),
    redirect: 'error',
    signal,
  });
  if (!response.ok || await response.text() !== 'Enquiry submitted') {
    throw new Error(`Form did not confirm the enquiry (HTTP ${response.status})`);
  }
}

async function verifyBaseline(simulateNoDelivery: boolean) {
  const { server: smtp, messages } = createInbox();
  let site: ReturnType<typeof createContactSite> | undefined;
  let smtpError: Error | undefined;

  async function checkDelivery(url: string, reference: string, kind: 'older' | 'baseline') {
    const expectedBody = [
      `Reference: ${reference}`,
      `Name: ${enquiry.name}`,
      `Email: ${enquiry.email}`,
      `Message: ${enquiry.message}`,
    ].join('\n');
    const firstNewMessage = messages.length;
    const deadline = performance.now() + deliveryWaitMs;
    await submit(url, reference, AbortSignal.timeout(deliveryWaitMs));
    if (kind === 'baseline') console.log(`Form reported success (${reference})`);

    while (true) {
      if (smtpError) throw smtpError;
      const match = messages.slice(firstNewMessage).some(({ mail, recipients, receivedAt }) =>
        receivedAt <= deadline &&
        mail.subject === 'Contact enquiry' &&
        recipients.includes('enquiries@example.test') &&
        mail.text?.replaceAll('\r\n', '\n').trimEnd() === expectedBody,
      );
      if (match) return;
      const remaining = deadline - performance.now();
      if (remaining <= 0) {
        throw new Error(`No matching email within ${deliveryWaitMs} ms (${reference})`);
      }
      await delay(Math.min(25, remaining));
    }
  }

  try {
    await new Promise<void>((resolve, reject) => {
      smtp.on('error', (error: Error) => {
        smtpError = error;
        reject(error);
      });
      smtp.listen(0, host, resolve);
    });

    site = createContactSite(portOf(smtp.server), simulateNoDelivery);
    const siteReady = once(site, 'listening');
    site.listen(0, host);
    await siteReady;
    const url = `http://${host}:${portOf(site)}${contactPath}`;

    if (simulateNoDelivery) {
      const olderReference = randomUUID();
      await checkDelivery(url, olderReference, 'older');
      console.log(`Older enquiry already in inbox (${olderReference})`);
    }

    const reference = randomUUID();
    await checkDelivery(url, reference, 'baseline');
    console.log(`VERIFIED DELIVERY: matching email received (${reference})`);
  } finally {
    const runningSite = site;
    if (runningSite?.listening) {
      await new Promise<void>((resolve) => {
        runningSite.close(() => resolve());
        runningSite.closeAllConnections();
      });
    }
    if (smtp.server.listening) await new Promise<void>((resolve) => smtp.close(resolve));
  }
}

const args = process.argv.slice(2);
if (args.length > 1 || (args.length === 1 && args[0] !== '--simulate-no-delivery')) {
  console.error('Usage: npm run baseline [-- --simulate-no-delivery]');
  process.exitCode = 2;
} else {
  try {
    await verifyBaseline(args.length === 1);
  } catch (error) {
    console.error('BROKEN BASELINE:', error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
