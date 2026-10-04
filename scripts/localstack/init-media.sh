#!/usr/bin/env bash
# LocalStack init hook (runs from /etc/localstack/init/ready.d once services are ready).
# Provisions the local media pipeline: bucket + CORS for browser presigned PUTs, a
# public-read bucket policy so committed originals render without signing GETs, and the
# renditions SQS queue the API enqueues onto. Idempotent across container restarts.
set -euo pipefail

BUCKET=openmic-media-local
QUEUE=openmic-media-renditions-local
INIT_DIR=/etc/localstack/init/ready.d
# SQS queues are region-scoped: the API resolves the queue in AWS_REGION (repo .env),
# while awslocal defaults to the container's AWS_DEFAULT_REGION (us-east-1). Pin queue
# creation to the API's region or POST /media 500s with QueueDoesNotExist after commit.
REGION="${MEDIA_AWS_REGION:-eu-west-1}"

if ! awslocal s3api head-bucket --bucket "$BUCKET" 2>/dev/null; then
  awslocal s3 mb "s3://$BUCKET"
fi

# Buckets created by `s3 mb` may carry the S3 default public-access block, which would
# reject the public-read policy below. Local dev only — the real bucket stays private.
awslocal s3api delete-public-access-block --bucket "$BUCKET" 2>/dev/null || true

awslocal s3api put-bucket-cors --bucket "$BUCKET" \
  --cors-configuration "file://$INIT_DIR/media-cors.json"
awslocal s3api put-bucket-policy --bucket "$BUCKET" \
  --policy "file://$INIT_DIR/media-bucket-policy.json"

awslocal sqs create-queue --queue-name "$QUEUE" --region "$REGION" >/dev/null

echo "localstack media init: bucket=$BUCKET queue=$QUEUE ready"
