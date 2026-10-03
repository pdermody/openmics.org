import type { SQSBatchItemFailure, SQSBatchResponse, SQSEvent } from 'aws-lambda';
import { GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { GetSecretValueCommand, SecretsManagerClient } from '@aws-sdk/client-secrets-manager';
import { createHmac } from 'node:crypto';

import { renderRenditions } from './renditions';

const s3Client = new S3Client({});
const secretsClient = new SecretsManagerClient({});

const mediaBucket = process.env.MEDIA_BUCKET;
const cdnBaseUrl = process.env.MEDIA_CDN_BASE_URL;
const apiBaseUrl = process.env.API_BASE_URL;
const callbackSecretArn = process.env.CALLBACK_SECRET_ARN;

let cachedCallbackSecret: string | undefined;
async function callbackSecret(): Promise<string> {
  if (cachedCallbackSecret) return cachedCallbackSecret;
  if (!callbackSecretArn) throw new Error('CALLBACK_SECRET_ARN environment variable is required');
  const response = await secretsClient.send(new GetSecretValueCommand({ SecretId: callbackSecretArn }));
  if (!response.SecretString) throw new Error('Media renditions callback secret has no string value');
  cachedCallbackSecret = response.SecretString;
  return cachedCallbackSecret;
}

type RenditionJob = {
  mediaId: string;
  objectKey: string;
};

function parseMessage(body: string): RenditionJob {
  const parsed = JSON.parse(body) as Partial<RenditionJob>;
  if (!parsed.mediaId || !parsed.objectKey) {
    throw new Error('Rendition queue message is missing required fields (mediaId, objectKey)');
  }
  return parsed as RenditionJob;
}

type RenditionMetadata = {
  url: string;
  width: number;
  height: number;
  mime_type: string;
  size_bytes: number;
};

async function processJob(job: RenditionJob): Promise<void> {
  if (!mediaBucket || !cdnBaseUrl || !apiBaseUrl) {
    throw new Error('MEDIA_BUCKET, MEDIA_CDN_BASE_URL, and API_BASE_URL environment variables are required');
  }

  const source = await s3Client.send(new GetObjectCommand({ Bucket: mediaBucket, Key: job.objectKey }));
  const sourceBytes = Buffer.from(await source.Body!.transformToByteArray());

  const { width: sourceWidth, height: sourceHeight, renditions: rendered } = await renderRenditions(sourceBytes);

  const renditions: Record<string, RenditionMetadata> = {};

  for (const variant of rendered) {
    const key = `renditions/${job.mediaId}/${variant.name}.webp`;
    await s3Client.send(new PutObjectCommand({
      Bucket: mediaBucket,
      Key: key,
      Body: variant.buffer,
      ContentType: 'image/webp',
      CacheControl: 'public, max-age=31536000, immutable',
    }));

    renditions[variant.name] = {
      url: `${cdnBaseUrl}/${key}`,
      width: variant.width,
      height: variant.height,
      mime_type: 'image/webp',
      size_bytes: variant.sizeBytes,
    };
  }

  renditions.original = {
    url: `${cdnBaseUrl}/${job.objectKey}`,
    width: sourceWidth,
    height: sourceHeight,
    mime_type: source.ContentType ?? 'application/octet-stream',
    size_bytes: source.ContentLength ?? sourceBytes.length,
  };

  // Signed callback into the API so only this pipeline can stamp rendition metadata.
  // Sent as text/plain so the API verifies the HMAC over the exact bytes that were
  // signed (a JSON content type would make Fastify parse + re-serialize the body).
  const payload = JSON.stringify({ width: sourceWidth, height: sourceHeight, renditions });
  const secret = await callbackSecret();
  const signature = createHmac('sha256', secret).update(payload, 'utf8').digest('hex');

  const response = await fetch(`${apiBaseUrl}/api/internal/media/${job.mediaId}/renditions-complete`, {
    method: 'POST',
    headers: {
      'Content-Type': 'text/plain',
      'x-media-renditions-signature': `sha256=${signature}`,
    },
    body: payload,
  });
  if (!response.ok) {
    throw new Error(`Renditions callback failed with status ${response.status}`);
  }
}

export async function handler(event: SQSEvent): Promise<SQSBatchResponse> {
  const failures: SQSBatchItemFailure[] = [];

  for (const record of event.Records) {
    try {
      await processJob(parseMessage(record.body));
    } catch (error) {
      console.error('Failed to generate media renditions', { messageId: record.messageId, error });
      failures.push({ itemIdentifier: record.messageId });
    }
  }

  return { batchItemFailures: failures };
}
