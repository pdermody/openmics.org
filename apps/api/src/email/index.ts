import type { AppConfig } from '../config.js';
import { createConsoleEmailAdapter, createMemoryEmailAdapter } from './local-adapters.js';
import { createSqsEmailAdapter } from './sqs-adapter.js';
import type { EmailAdapter } from './types.js';

export function createEmailAdapter(config: AppConfig): EmailAdapter {
  switch (config.emailAdapter) {
    case 'ses': {
      if (!config.emailQueueUrl) throw new Error('EMAIL_QUEUE_URL is required when EMAIL_ADAPTER=ses');
      return createSqsEmailAdapter({ queueUrl: config.emailQueueUrl, region: config.awsRegion });
    }
    case 'memory':
      return createMemoryEmailAdapter();
    case 'console':
    default:
      return createConsoleEmailAdapter();
  }
}

export type { EmailAdapter, EmailMessage } from './types.js';
export { createConsoleEmailAdapter, createMemoryEmailAdapter } from './local-adapters.js';
