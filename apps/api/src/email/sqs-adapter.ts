import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';
import type { EmailAdapter, EmailMessage } from './types.js';

export type SqsEmailAdapterOptions = {
  queueUrl: string;
  region: string;
};

/** Enqueues the email onto SQS; the email-sender Lambda (see infra/) consumes it and calls SES. */
export function createSqsEmailAdapter({ queueUrl, region }: SqsEmailAdapterOptions): EmailAdapter {
  const client = new SQSClient({ region });

  return {
    async send(message: EmailMessage) {
      await client.send(new SendMessageCommand({
        QueueUrl: queueUrl,
        MessageBody: JSON.stringify(message),
      }));
    },
  };
}
