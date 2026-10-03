import { SendMessageCommand, SQSClient } from '@aws-sdk/client-sqs';

// Rendition job queue boundary. Production enqueues onto SQS for the media-renditions
// Lambda (infra/lib/lambda/media-renditions), mirroring the email pipeline. Tests and
// local dev use a recording in-memory fake; media rows simply keep `renditions = null`
// until a real pipeline reports back, and clients fall back to the original URL.

export type RenditionJob = {
  mediaId: string;
  /** Canonical `original/{mediaId}.{ext}` object key the Lambda should render from. */
  objectKey: string;
};

export type RenditionsQueueAdapter = {
  enqueue(job: RenditionJob): Promise<void>;
};

export function createSqsRenditionsQueueAdapter(options: { queueUrl: string; region: string }): RenditionsQueueAdapter {
  const client = new SQSClient({ region: options.region });
  return {
    async enqueue(job: RenditionJob) {
      await client.send(new SendMessageCommand({
        QueueUrl: options.queueUrl,
        MessageBody: JSON.stringify(job),
      }));
    },
  };
}

export type LocalRenditionsQueueAdapter = RenditionsQueueAdapter & {
  /** Test assertion hook, mirroring the memory email adapter's `.sent[]`. */
  readonly enqueued: RenditionJob[];
};

export function createLocalRenditionsQueueAdapter(): LocalRenditionsQueueAdapter {
  const enqueued: RenditionJob[] = [];
  return {
    enqueued,
    async enqueue(job: RenditionJob) {
      enqueued.push(job);
    },
  };
}
