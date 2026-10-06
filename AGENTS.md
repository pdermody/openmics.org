# Repository Guidance

## Source of Truth

- `docs/decisions.md` contains settled cross-document decisions and wins conflicts.
- `docs/3-open-mic-requirements.md` defines product behavior and permissions.
- `docs/6-open-mic-vanity-urls.md` defines handle lifecycle, casing, routing, and visibility.
- `docs/5-open-mic-frontend-architecture.md` defines frontend structure and the canonical route map.
- `openapi.yaml` is the executable JSON API contract.
- `FEATURE-PLAN.md` is the Phase 1 feature-scope sequencing authority and records the current implementation baseline.
- `docs/4-open-mic-technical-architecture.md` indexes the data model and API design documents. Treat `docs/architecture/data-model.md` and `docs/architecture/api-design.md` as current boundaries.

When sources disagree, resolve the decision in `docs/decisions.md` before changing behavior. Do not silently choose an interpretation or revive deferred features.

## Cross-Cutting Rules

- Preserve guest registration provenance separately from claimed account ownership and adopted public attribution.
- Handles preserve canonical casing, compare case-insensitively, and distinguish case-only changes from semantic renames.
- Enforce authorization and visibility in the API; frontend controls are not a security boundary.
- Keep Cognito, email, S3, geocoding, and live-update providers behind adapters with deterministic test fakes.
- Use partial `PATCH` operations for partial resource updates. Keep `/api` JSON-only and preserve the established public vanity routes.
- Do not deploy or bootstrap AWS resources without explicit user confirmation.

## Validation

- Use [VALIDATION.md](./VALIDATION.md) for task-based validation profiles and command details; choose the narrowest checks that cover the change.
- `npm run typecheck:api` checks the API TypeScript boundary.
- `npm run test` runs API typecheck/unit/API/integration tests and the web suite; integration tests require Docker/Testcontainers.
- Run `npm run validate:openapi` and `npm run lint:openapi` after contract changes.
- Run `npm run check:links` after moving or renaming documents.
- Run `cd infra && npm run build && npm run synth` after infrastructure changes.
- Markdown is not linted; do not add or reintroduce Markdown lint checks.

Folder-specific conventions live in `apps/api/AGENTS.md`, `apps/web/AGENTS.md`, and `infra/AGENTS.md`.
