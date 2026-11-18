import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import nodemailer from 'nodemailer';

export const contactPath = '/contact';

const form = `<!doctype html>
<html lang="en">
<meta charset="utf-8">
<title>Contact</title>
<h1>Contact</h1>
<form method="post" action="${contactPath}">
  <label>Name <input name="name" required></label>
  <label>Email <input name="email" type="email" required></label>
  <label>Message <textarea name="message" required></textarea></label>
  <label>Reference <input name="reference" required></label>
  <button type="submit">Send enquiry</button>
</form>
</html>`;

export function createContactSite(smtpPort: number, simulateNoDelivery: boolean) {
  const mailer = nodemailer.createTransport({
    host: '127.0.0.1',
    port: smtpPort,
    ignoreTLS: true,
    connectionTimeout: 1_000,
    greetingTimeout: 1_000,
    socketTimeout: 1_000,
  });
  let deliveredFirstEnquiry = false;

  async function handle(request: IncomingMessage, response: ServerResponse) {
    if (request.url !== contactPath) {
      response.writeHead(404).end('Page not found');
      return;
    }
    if (request.method === 'GET') {
      response.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' }).end(form);
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
    const fields = new URLSearchParams(body);
    const name = fields.get('name')?.trim();
    const email = fields.get('email')?.trim();
    const message = fields.get('message')?.trim();
    const reference = fields.get('reference')?.trim();
    if (!name || !email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !message ||
        !reference || !/^[a-zA-Z0-9-]{1,64}$/.test(reference)) {
      response.writeHead(400).end('Enter a valid name, email, message, and reference');
      return;
    }

    // The failure scenario delivers the older enquiry before simulating the broken form.
    if (!simulateNoDelivery || !deliveredFirstEnquiry) {
      await mailer.sendMail({
        from: 'contact@example.test',
        to: 'enquiries@example.test',
        subject: 'Contact enquiry',
        text: `Reference: ${reference}\nName: ${name}\nEmail: ${email}\nMessage: ${message}`,
      });
      deliveredFirstEnquiry = true;
    }
    response.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' }).end('Enquiry submitted');
  }

  return createServer((request, response) => {
    void handle(request, response).catch(() => {
      if (!response.headersSent) response.writeHead(502).end('Could not submit enquiry');
    });
  });
}
