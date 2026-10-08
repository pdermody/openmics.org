---
name: deploy-prod
description: Build, migrate, and deploy OpenMic to production (openmics.org).
disable-model-invocation: true
---
Deploy the current checkout to production. Target: AWS profile `openmic`, account `163742164398`, region `eu-west-1`, environment `prod`, domain `openmics.org`.

Run every AWS and CDK command with these variables, and never pipe CDK or AWS output through a pager:

```bash
export AWS_PROFILE=openmic AWS_REGION=eu-west-1 CDK_DEFAULT_REGION=eu-west-1 CDK_DEFAULT_ACCOUNT=163742164398 OPENMIC_ENVIRONMENT=prod OPENMIC_SES_DOMAIN=openmics.org AWS_PAGER=''
```

Stop and ask me before each step marked **Confirm**. Stop and report if any step fails; do not retry production writes.

## 1. Preflight (read-only)

1. `git status --short --branch`: report uncommitted changes and ask whether they belong in this release.
2. `aws sts get-caller-identity --query Account --output text` must print `163742164398`.
3. Check stacks in both `eu-west-1` and certificate region `us-east-1`: every `OpenMic*-prod` stack must be `CREATE_COMPLETE` or `UPDATE_COMPLETE`, and the ECS service in cluster `openmic-prod` must have its desired task count running with rollout `COMPLETED`. A certificate replacement blocked on an existing CloudFront consumer needs a separately confirmed certificate-only recovery plan before this release proceeds. Do not retry the certificate deployment or publish new frontend assets to unblock cleanup.
4. List new files in `apps/api/migrations/` since the last deployment, and summarize any that delete or rewrite data.

## 2. Build

Run `npm run build:web` then `npm run build:api` from the repository root. The API image includes the built SPA index: verify the staged Docker context contains `apps/web/dist/index.html`, the compiled city-import source/catalogue inputs, and no `.env` files. From `infra/`, build and synth with the production environment, then review per-stack diffs before deploying the migration task. `cdk diff` can publish assets and create diagnostic change sets; obtain confirmation for those AWS writes. Stop on unexpected protected-resource replacement/deletion.

## 3. Migrate the RDS database

1. **Confirm**, then redeploy only the migration task so its image contains the current migrations (`--exclusively` leaves the API service untouched):

   ```bash
   cd infra && npm run deploy -- OpenMicMigrationStack-prod --exclusively --require-approval never
   ```

2. **Confirm** the preview task launch, then run `npm run db:migrate:prod -- --preview` from the repository root. It prints the actual pending SQL and verified database recovery point without applying changes or prompting. When schema is already current, it also previews the city import.
3. Review every pending migration for destructive changes, locks and compatibility with the running API. **Confirm** with me using the actual SQL, recovery point and separate-commit risk, then run `npm run db:migrate:prod -- --expected-preview=<printed-SHA256>` interactively (add `--yes` only after that explicit approval). It repeats the preview, rejects changed SQL fingerprints and refreshes recovery evidence before apply. If the preview changes, stop and seek renewed approval rather than applying an unreviewed migration list.
4. If migrations are pending, the helper applies them and then previews/imports the packaged city catalogue in the same ECS task. If schema is current, it uses a separate city-only task. Both paths verify no migrations remain and preview cities afterward. Verify expected managed identity coverage, UUID preservation and unmanaged rows before application rollout; logs alone do not prove database parity.

Never run migrations through the API or on API startup. Migrations and city import commit separately: import failure stops rollout but does not undo committed migrations. Stop on missing logs/recovery evidence or any task failure; inspect persistent database state before a separately approved recovery. Migration `down` is not data recovery; RDS point-in-time recovery restores a new instance and requires a separately approved cutover.

## 4. Update the infrastructure

1. Refresh reviewed per-stack diffs from `infra/`. Stop if they propose replacing/deleting the database, Cognito user pool, Route 53 records, or certificate. Verify both frontend/media certificate exports contain the issued ARN before allowing a frontend update; a stale export can restore an obsolete certificate.
2. **Confirm each stack separately**, then deploy with `--exclusively --require-approval never` in this order: `OpenMicMediaStack-prod`, `OpenMicApiStack-prod`, `OpenMicFrontendStack-prod`. Do not use `--all` to bypass sequencing. Schema/import checks must pass before the scheduled media worker activates; API checks must pass before new frontend assets publish. See [the settled schema-first decision](../../../docs/decisions.md#media-delivery).
3. After MediaStack, verify private bucket/CDN, queues and worker logs. Purge runs as a daily public-IP Fargate task on the stack's worker cluster, not a VPC Lambda; it pages through due records in batches of 500 within a five-minute cap. Inspect task exit codes and the purge container's CloudWatch logs. Ask before manually starting a purge task because it can delete due queued objects. After ApiStack, verify ECS rollout/healthy targets, API health, mapped city search and schema errors. After FrontendStack, wait for CloudFront deployment/invalidation. A one-task Spot service can briefly disrupt availability; do not claim zero downtime without reviewing its capacity and rollout settings.

## 5. Verify

1. The ECS service reaches rollout `COMPLETED` with its desired count running.
2. `https://openmics.org/` and a deep link such as `https://openmics.org/dashboard` return 200 HTML. Read `LoadBalancerDnsName` from ApiStack and verify `http://<ALB>/health` returns JSON with `{"status":"ok"}`. `/api/health` is not a health route: CloudFront's SPA fallback can make it return HTML 200, which must not count as API success. Verify a real public API request such as `/api/cities/search?q=London&country=GB` returns `application/json` with the expected `items` shape.
3. Check the API CloudWatch logs from the last 15 minutes for startup, database, or schema errors.
4. Verify city search/details use database UUIDs without import-required errors, media deep links reach the API, and media worker logs/queues are healthy. Ask before creating production smoke-test data for upload/rendition verification; report untested paths explicitly. Check final stacks in both regions and certificate consumers.

Report what was deployed, which migrations ran, and the smoke-test results.
