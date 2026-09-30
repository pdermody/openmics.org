# Infrastructure Guidance

## CDK Boundary

- This is a standalone AWS CDK TypeScript package with its own `package.json`, `tsconfig.json`, and lockfile. `bin/infra.ts` is the CDK app entrypoint.
- Keep bounded infrastructure concerns in separate stack classes under `lib/`: network, database, auth, email, API, migration, certificates, and frontend hosting.
- The deployed architecture is ECS Fargate for the API, PostgreSQL/PostGIS in RDS, Cognito for auth, SES through SQS and a Lambda consumer for email, and private S3 plus CloudFront for the SPA.
- Preserve environment names from `OPENMIC_ENVIRONMENT` or CDK context and the certificate-region requirement for CloudFront. Keep stack outputs and cross-stack references explicit.
- The API image and migration task must receive secrets through Secrets Manager/task configuration. Never hard-code credentials, tokens, or provider keys in CDK source or synthesized templates.
- Keep the migration task separate from normal API startup. Database migrations are explicit operator-triggered work, not an implicit application boot side effect.

## Safe Workflow

- Install/use dependencies from `infra/` for infrastructure work, not the root package.
- Run `npm run build` for TypeScript validation and `npm run synth` to validate the synthesized CloudFormation template.
- Use `npm run diff` to inspect intended AWS changes. `npm run deploy` and `npm run bootstrap` require explicit user confirmation because they affect real AWS resources.
- Changes under `infra/` should also be checked against `docs/decisions.md`, `FEATURE-PLAN.md`, and the API/web deployment assumptions. Do not use the historical EC2/Amplify Hosting narrative as current guidance.
- Keep least-privilege IAM, private data resources, deletion policies, health checks, logging, and environment-specific naming intact unless the task explicitly changes the deployment design.
- Infrastructure changes are not complete until the relevant application image/build assumptions still hold, especially the frontend `apps/web/dist` asset consumed at synth time.