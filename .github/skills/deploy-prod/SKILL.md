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
3. Check that every `OpenMic*-prod` CloudFormation stack is `CREATE_COMPLETE` or `UPDATE_COMPLETE`, and that the ECS service in cluster `openmic-prod` has its desired task count running with rollout `COMPLETED`.
4. List new files in `apps/api/migrations/` since the last deployment, and summarize any that delete or rewrite data.

## 2. Build

Run `npm run build:api` and `npm run build:web` from the repository root.

## 3. Migrate the RDS database

1. **Confirm**, then redeploy only the migration task so its image contains the current migrations (`--exclusively` leaves the API service untouched):

   ```bash
   cd infra && npm run deploy -- OpenMicMigrationStack-prod --exclusively --require-approval never
   ```

2. From the repository root, run `npm run db:migrate:prod` in a terminal. It runs a dry-run Fargate task, prints the pending SQL and the database recovery point, then waits for `yes`.
3. **Confirm** with me using the printed migration list and recovery point, then answer the script's prompt. It applies the migrations once and verifies that none remain pending.

Never run migrations through the API or on API startup. Migration `down` is not a rollback for data changes; recovery means restoring RDS to the printed recovery point.

## 4. Update the infrastructure

1. From `infra/`, run `npm run diff` and summarize the changes per stack. Stop if it proposes replacing or deleting the database, Cognito user pool, Route 53 records, or certificate.
2. **Confirm**, then run `npm run deploy -- --all --require-approval never`. It usually takes longer than two minutes, so run it in a background terminal and poll until CDK prints its final result.

## 5. Verify

1. The ECS service reaches rollout `COMPLETED` with its desired count running.
2. `https://openmics.org/` and a deep link such as `https://openmics.org/dashboard` return 200, and `https://openmics.org/api/health` returns 200.
3. Check the API CloudWatch logs from the last 15 minutes for startup, database, or schema errors.

Report what was deployed, which migrations ran, and the smoke-test results.
