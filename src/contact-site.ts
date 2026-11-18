import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import nodemailer from 'nodemailer';
import { fieldDetails, type FormDefinition } from './form-definition.ts';

export const contactPath = '/contact';

export type ContactTarget = {
  definition: FormDefinition;
  withholdMail: boolean;
};

function renderForm(definition: FormDefinition) {
  const controls = definition.fields.map(({ name, required }) => {
    const { label, control } = fieldDetails[name];
    const attributes = `name="${name}"${required ? ' required' : ''}`;
    const input = control === 'textarea'
      ? `<textarea ${attributes}></textarea>`
      : `<input type="${control}" ${attributes}>`;
    return `  <label>${label} ${input}</label>`;
  }).join('\n');

  return `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<title>Contact</title>
<h1>Contact</h1>
<form method="post" action="${contactPath}">
${controls}
  <button type="submit">Send enquiry</button>
</form>
</html>`;
}

export function createContactSite(smtpPort: number, target: ContactTarget) {
  const mailer = nodemailer.createTransport({
    host: '127.0.0.1',
    port: smtpPort,
    ignoreTLS: true,
    connectionTimeout: 1_000,
    greetingTimeout: 1_000,
    socketTimeout: 1_000,
  });
  async function handle(request: IncomingMessage, response: ServerResponse) {
    if (request.url !== contactPath) {
      response.writeHead(404).end('Page not found');
      return;
    }
    const { definition, withholdMail } = target;
    if (request.method === 'GET') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(renderForm(definition));
      return;
    }
    if (request.method !== 'POST') {
      response.writeHead(405, { Allow: 'GET, POST' }).end('Method not allowed');
      return;
    }
    if (request.headers['content-type']?.split(';')[0] !== 'application/x-www-form-urlencoded') {
      response.writeHead(415).end('Expected a URL-encoded form');
      return;
    }

    let body = '';
    request.setEncoding('utf8');
    for await (const chunk of request) {
      body += chunk;
      if (Buffer.byteLength(body) > 4096) {
        response.writeHead(413, { Connection: 'close' }).end('Enquiry is too large');
        return;
      }
    }
    const submitted = new URLSearchParams(body);
    const values = Object.fromEntries(definition.fields.map(({ name }) => [name, submitted.get(name)?.trim()]));
    const { email, reference } = values;
    if (definition.fields.some(({ name, required }) => required && !values[name]) ||
        (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) ||
        (reference && !/^[a-zA-Z0-9-]{1,64}$/.test(reference))) {
      response.writeHead(400).end('Enter valid values for the contact form');
      return;
    }

    const text = definition.emailFields
      .filter((name) => values[name])
      .map((name) => `${fieldDetails[name].label}: ${values[name]}`)
      .join('\n');
    // The bundled regression leaves the form confirmation active with an empty email.
    if (text && !withholdMail) {
      await mailer.sendMail({
        from: 'contact@example.test',
        to: 'enquiries@example.test',
        subject: 'Contact enquiry',
        text,
      });
    }
    response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Enquiry submitted');
  }

  return createServer((request, response) => {
    void handle(request, response).catch(() => {
      if (!response.headersSent) response.writeHead(502).end('Could not submit enquiry');
    });
  });
}
