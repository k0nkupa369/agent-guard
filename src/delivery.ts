import { randomUUID } from 'node:crypto';
import { once } from 'node:events';
import type { Server } from 'node:net';
import { setTimeout as delay } from 'node:timers/promises';
import { contactPath, createContactSite, type ContactTarget } from './contact-site.ts';
import { originalForm } from './form-definition.ts';
import { createInbox } from './inbox.ts';

const host = '127.0.0.1';
const deliveryWaitMs = 1_500;
const enquiry = {
  name: 'Casey Example',
  email: 'casey@example.test',
  message: 'Could you send me a sample catalogue?',
};

export type DeliveryCheck = {
  stage: 'older' | 'baseline' | 'with-company' | 'without-company' | 'recovery';
  reference: string;
  form: { status: number; matches: boolean } | null;
  confirmation: { status: number; accepted: boolean } | null;
  email: { subject: string; recipients: string[]; body: string } | null;
  failure?: string;
};

function portOf(server: Server) {
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Local server has no TCP address');
  return address.port;
}

function matchesForm(html: string, expectsCompany: boolean) {
  // shortcut: match the local template's markup, use an HTML parser if templates become configurable
  const form = html.match(/<form method="post" action="([^"]+)">([\s\S]*?)<\/form>/);
  if (!form || form[1] !== contactPath || !form[2].includes('<button type="submit">')) return false;

  const controls: readonly string[] = form[2].match(/<(?:input|textarea) [^>]+>/g) ?? [];
  const expected = [
    '<input type="text" name="name" required>',
    '<input type="email" name="email" required>',
    '<textarea name="message" required>',
    '<input type="text" name="reference" required>',
  ];
  if (expectsCompany) expected.push('<input type="text" name="company">');
  return controls.length === expected.length && expected.every((control) => controls.includes(control));
}

type CheckDelivery = (stage: DeliveryCheck['stage'], company?: string) => Promise<DeliveryCheck>;

export async function withContactDemo(run: (target: ContactTarget, checkDelivery: CheckDelivery) => Promise<void>) {
  const { server: smtp, messages } = createInbox();
  const target = { definition: structuredClone(originalForm), withholdMail: false };
  let site: ReturnType<typeof createContactSite> | undefined;
  let smtpError: Error | undefined;

  try {
    await new Promise<void>((resolve, reject) => {
      smtp.on('error', (error: Error) => {
        smtpError = error;
        reject(error);
      });
      smtp.listen(0, host, resolve);
    });

    site = createContactSite(portOf(smtp.server), target);
    const siteReady = once(site, 'listening');
    site.listen(0, host);
    await siteReady;
    const url = `http://${host}:${portOf(site)}${contactPath}`;

    await run(target, async (stage, company) => {
      const reference = randomUUID();
      const submission = new URLSearchParams({ ...enquiry, reference });
      const expectedLines = [
        `Reference: ${reference}`,
        `Name: ${enquiry.name}`,
        `Email: ${enquiry.email}`,
        `Message: ${enquiry.message}`,
      ];
      if (company !== undefined) {
        submission.set('company', company);
        expectedLines.push(`Company: ${company}`);
      }
      const expectedBody = expectedLines.join('\n');
      const check: DeliveryCheck = { stage, reference, form: null, confirmation: null, email: null };
      const deadline = performance.now() + deliveryWaitMs;
      const signal = AbortSignal.timeout(deliveryWaitMs);
      try {
        const page = await fetch(url, { redirect: 'error', signal });
        check.form = { status: page.status, matches: false };
        check.form.matches = page.ok && matchesForm(await page.text(),
          stage === 'with-company' || stage === 'without-company');
        if (!check.form.matches) {
          throw new Error(`Served form did not match expected controls (HTTP ${page.status})`);
        }

        const firstNewMessage = messages.length;
        const response = await fetch(url, {
          method: 'POST',
          body: submission,
          redirect: 'error',
          signal,
        });
        check.confirmation = { status: response.status, accepted: false };
        check.confirmation.accepted = response.ok && await response.text() === 'Enquiry submitted';
        if (!check.confirmation.accepted) {
          throw new Error(`Form did not confirm the enquiry (HTTP ${response.status})`);
        }

        while (true) {
          if (smtpError) throw smtpError;
          for (const { mail, recipients, receivedAt } of messages.slice(firstNewMessage)) {
            const body = mail.text?.replaceAll('\r\n', '\n').trimEnd();
            if (receivedAt <= deadline && mail.subject === 'Contact enquiry' &&
                recipients.length === 1 && recipients[0] === 'enquiries@example.test' &&
                body === expectedBody) {
              check.email = { subject: mail.subject, recipients, body };
              return check;
            }
          }
          const remaining = deadline - performance.now();
          if (remaining <= 0) {
            throw new Error(`No matching email within ${deliveryWaitMs} ms (${reference})`);
          }
          await delay(Math.min(25, remaining));
        }
      } catch (error) {
        check.failure = error instanceof Error ? error.message : String(error);
        return check;
      }
    });
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
