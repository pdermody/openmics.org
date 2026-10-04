// One-off probe: reproduce the renditions SQS enqueue with the same SDK/env as the API.
const { SQSClient, SendMessageCommand } = await import('@aws-sdk/client-sqs');
const client = new SQSClient({ region: 'eu-west-1' });
try {
  const r = await client.send(new SendMessageCommand({
    QueueUrl: 'http://localhost.localstack.cloud:4566/000000000000/openmic-media-renditions-local',
    MessageBody: JSON.stringify({ probe: true }),
  }));
  console.log('SEND OK', r.MessageId);
} catch (e) {
  console.log('SEND FAILED:', e.name, '-', e.message);
}
