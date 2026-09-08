import type { SQSBatchItemFailure, SQSBatchResponse, SQSEvent } from 'aws-lambda';
import { SESv2Client, SendEmailCommand } from '@aws-sdk/client-sesv2';

const sesClient = new SESv2Client({});
const senderAddress = process.env.SENDER_ADDRESS;

type EmailMessage = {
  to: string;
  subject: string;
  html: string;
  text: string;
};

function parseMessage(body: string): EmailMessage {
  const parsed = JSON.parse(body) as Partial<EmailMessage>;
  if (!parsed.to || !parsed.subject || !parsed.html || !parsed.text) {
    throw new Error('Email queue message is missing required fields (to, subject, html, text)');
  }
  return parsed as EmailMessage;
}

export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  if (!senderAddress) throw new Error('SENDER_ADDRESS environment variable is required');

  const failures: SQSBatchItemFailure[] = [];

  for (const record of event.Records) {
    try {
      const message = parseMessage(record.body);
      await sesClient.send(new SendEmailCommand({
        FromEmailAddress: senderAddress,
        Destination: { ToAddresses: [message.to] },
        Content: {
          Simple: {
            Subject: { Data: message.subject, Charset: 'UTF-8' },
            Body: {
              Html: { Data: message.html, Charset: 'UTF-8' },
              Text: { Data: message.text, Charset: 'UTF-8' },
            },
          },
        },
      }));
    } catch (error) {
      console.error('Failed to send queued email', { messageId: record.messageId, error });
      failures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures: failures };
}
