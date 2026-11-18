import { once } from 'node:events';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

export async function withLoopbackHttp<Result>(
  handle: (request: IncomingMessage, response: ServerResponse) => Promise<void>,
  run: (origin: string) => Promise<Result>,
) {
  const host = '127.0.0.1';
  const server = createServer((request, response) => {
    void handle(request, response).catch(() => {
      if (!response.headersSent) response.writeHead(400).end('Invalid request');
      else response.destroy();
    });
  });
  try {
    const ready = once(server, 'listening');
    server.listen(0, host);
    await ready;
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Loopback server has no TCP address');
    return await run(`http://${host}:${address.port}`);
  } finally {
    if (server.listening) {
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
        server.closeAllConnections();
      });
    }
  }
}

export async function readRequestBody(request: IncomingMessage) {
  request.setEncoding('utf8');
  let body = '';
  for await (const chunk of request) {
    body += chunk;
    if (Buffer.byteLength(body) > 4096) throw new Error('Request body is too large');
  }
  return body;
}
