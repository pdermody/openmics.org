# Validation Guide

Choose checks from the changed behavior; do not run the full suite by default when a focused profile gives adequate coverage. Commands below assume the repository root unless noted.

## API

- TypeScript boundary: `npm run typecheck:api`
- Database/AWS-free API units: `npm run test:unit`
- Fastify route and contract tests: `npm run test:api`
- PostgreSQL/PostGIS integration tests: `npm run test:integration` (requires Docker/Testcontainers)
- For a focused Vitest run, append a test-name filter to the scoped package script, for example:
  `npm run test:integration -- --testNamePattern="searches the city catalogue"`

The root package scripts scope API tests to `apps/api/tests/...` and exclude `infra/**`. Prefer these scripts over invoking Vitest against an individual API test path from the repository root: generated copies under `infra/cdk.out` can otherwise be discovered too.

## Web

- Production TypeScript/Vite build: `npm run build:web`
- Web tests and untranslated-UI check: `npm run test:web`
- Full web lint: `npm run lint --prefix apps/web`
- To run a focused Vitest file, run from `apps/web` so Vitest loads its jsdom setup and configuration:
  `npm exec -- vitest run src/test/<focused-test>.test.tsx`
- To lint only changed frontend files, run Oxlint from `apps/web` and pass those file paths:
  `npm exec -- oxlint src/views/<changed-view>.tsx`

If full lint reports errors, compare the reported files and dependencies with the current diff before attributing them to the change. An untouched file can still be affected by a changed dependency. Label findings as pre-existing only when earlier output or a baseline comparison establishes that; otherwise report the attribution as unverified. Report changed-file lint separately from full lint.

## OpenAPI and documentation

- After contract changes: `npm run validate:openapi` and `npm run lint:openapi`
- After moving or renaming documents: `npm run check:links`. This currently checks selected documents under `docs/`; verify relative links in new root guides and prompt files separately.
- Markdown has no configured lint step; do not add one for validation.

## City catalogue and packaging

- Validate all catalogue entries: `npm run cities:validate`
- After catalogue loader, API build, or packaging changes: `npm run build:api`
- For search, ranking, and schema changes, run the relevant city unit tests through the scoped script, e.g.:
  `npm run test:unit -- --testNamePattern="city catalogue"`
- For database mapping, import, UUID stability, retirement, or PostGIS behavior, run the relevant integration test, e.g.:
  `npm run test:integration -- --testNamePattern="searches the city catalogue"`
- When changing module-relative asset loading or packaging, also verify that the compiled API can load the catalogue when imported by absolute path from a working directory outside the repository.

Do not invoke a city import against a configured database unless the task explicitly requires it and the target database is confirmed.

## Infrastructure

From `infra/`:

- `npm run build`
- `npm run synth`

These validate the CDK package and synthesized templates; they do not authorize deployment. Follow [infra/AGENTS.md](./infra/AGENTS.md) and get explicit confirmation before deploying or bootstrapping AWS resources.

## Full suite

Run `npm test` for repository-wide API typecheck/unit/API/integration, Lambda, and web checks. Integration tests require Docker/Testcontainers. The command does not replace separate production builds (`npm run build:api` and `npm run build:web`) or the OpenAPI checks when those areas changed.
