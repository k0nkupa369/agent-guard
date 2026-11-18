import { simpleParser, type ParsedMail } from 'mailparser';
import { SMTPServer } from 'smtp-server';

const maxMessageBytes = 16 * 1024;

type ReceivedEmail = {
  mail: ParsedMail;
  recipients: string[];
  receivedAt: number;
};

export function createInbox() {
  const messages: ReceivedEmail[] = [];
  const server = new SMTPServer({
    disabledCommands: ['AUTH', 'STARTTLS'],
    disableReverseLookup: true,
    size: maxMessageBytes,
    socketTimeout: 2_000,
    closeTimeout: 500,
    onData(stream, session, done) {
      const recipients = session.envelope.rcptTo.map(({ address }) => address);
      async function receive() {
        const chunks: Buffer[] = [];
        let bytes = 0;
        for await (const chunk of stream) {
          bytes += chunk.length;
          if (bytes <= maxMessageBytes) chunks.push(chunk);
        }
        if (bytes > maxMessageBytes || stream.sizeExceeded) {
          throw new Error('Email exceeds the local inbox size limit');
        }
        const mail = await simpleParser(Buffer.concat(chunks), {
          skipHtmlToText: true,
          skipTextToHtml: true,
        });
        messages.push({ mail, recipients, receivedAt: performance.now() });
      }
      void receive().then(() => done(), (error: Error) => done(error));
    },
  });
  return { server, messages };
}
