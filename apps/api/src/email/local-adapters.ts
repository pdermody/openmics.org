import type { EmailAdapter, EmailMessage } from './types.js';

/** Logs the email to stdout instead of sending it — used for local development. */
export function createConsoleEmailAdapter(): EmailAdapter {
  return {
    async send(message: EmailMessage) {
      console.log(`[email:console] To: ${message.to}\nSubject: ${message.subject}\n${message.text}\n`);
    },
  };
}

/** Captures sent messages in memory instead of sending them — used in tests. */
export function createMemoryEmailAdapter(): EmailAdapter & { sent: EmailMessage[] } {
  const sent: EmailMessage[] = [];
  return {
    sent,
    async send(message: EmailMessage) {
      sent.push(message);
    },
  };
}
