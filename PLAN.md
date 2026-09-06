# Plan: Build The Phase 1 API

TL;DR: Build a TypeScript/Fastify API first, using an OpenAPI-first Phase 1 contract, explicit SQL migrations managed by node-pg-migrate, and three test layers: DB-free Vitest unit tests, ephemeral Postgres/PostGIS integration tests with Testcontainers for constraints/triggers/concurrency, and Fastify.inject API tests. Production authentication will use Cognito behind an adapter; tests will use deterministic injected identities. Node 22 LTS and Terraform are the agreed platform baselines.

## Phase 1: Contract and Decisions

1. Reduce/review `openapi.yaml` to the Phase 1 executable contract: organizer series/event operations, public reads, guest/authenticated/kiosk registration, email verification, magic-link editing, registration claiming/adoption, roster/performance operations, handles, and organizer-owned media. Exclude reviews, comments, reactions, messaging, follows, and other community endpoints from the first implementation contract; retain them only as explicitly deferred architecture notes.
2. Reconcile contract mismatches before route implementation: use `PATCH` for partial profile/open-mic updates, define the public vanity resolver separately from the `/api` base if needed, align handle statuses and case-only updates, and make registration provenance/adopted-profile fields explicit.
3. Resolve remaining policy details that affect schemas and tests: exact duplicate identity key for guest registrations, claim conflict errors, consent audit/revocation behavior, soft-delete retention periods, rate limits, media URL/type validation, and public roster visibility rules.

## Phase 2: Backend Foundation

4. Create a strict TypeScript service under `apps/api/` in the existing monorepo, with `src/app.ts` as a testable Fastify factory and `src/server.ts` as the process entrypoint.
5. Add Fastify plugins for configuration, structured errors, request IDs/logging, database pool/transactions, OpenAPI validation, and authentication context. Keep Cognito behind an adapter; production verifies Cognito tokens, while tests inject deterministic identities without AWS.
6. Standardize Node 22 LTS, Vitest, Fastify native injection, `pg`, Zod or the selected schema validator, and SQL-first migrations managed by `node-pg-migrate`. Keep SQL explicit for Postgres/PostGIS triggers and constraints.
7. Add Terraform as the infrastructure boundary for the API's AWS resources, but keep AWS deployment outside this API-first implementation slice until the local contract and test suite are stable.

## Phase 3: Database and Domain Behavior

8. Add ordered migrations for UUIDs, timestamps, soft-delete/recovery fields, accounts, profiles, global Handles, open-mic series, events, registrations, performances, media, and Phase 1 indexes/seeds. Enable PostGIS and model generated locations/GIST indexes where required.
9. Implement database-enforced behavior: case-insensitive handle uniqueness, canonical casing updates, redirect/quarantine/tombstone states, handle exclusive-arc rules, current-handle maintenance, event location snapshot rules, complete-or-absent location overrides, registration closure, atomic capacity enforcement, duplicate prevention, email verification/claim invariants, adopted attribution, and soft-delete recovery.
10. Keep guest provenance separate from claimed account and adopted public profile. Use transactions and row locks/advisory locking or equivalent PostgreSQL mechanisms for concurrent registration attempts.

## Phase 4: API Vertical Slices

11. Implement shared request validation, response serialization, error envelopes, auth context, and ownership checks.
12. Implement profiles/accounts/handles and public handle resolution.
13. Implement organizer-owned open-mic series and event creation/edit/lifecycle operations.
14. Implement public home/profile/open-mic/event/registration reads with Phase 1 visibility filtering.
15. Implement guest, authenticated, and kiosk registration; email verification; protected magic-link editing; claiming and later profile attribution; roster and performance operations.
16. Implement organizer-owned photo/video-link management and upload/storage ports. Keep Cognito, SES, and S3 behind adapters with fakes for automated tests.

## Phase 5: Test Layers

17. Add DB-free Vitest unit tests for handle normalization and rename policy, event defaults/snapshot validation, registration visibility/claim rules, authorization/ownership decisions, validation, error mapping, and pure services using repository fakes.
18. Add Testcontainers integration tests using ephemeral Postgres/PostGIS. Reset/migrate from scratch, seed fixtures, and test constraints, partial indexes, triggers, generated locations, handle casing/rename transitions, registration invariants, soft-delete/recovery, and concurrent capacity races. Do not substitute SQLite or mocks for database behavior.
19. Add Fastify.inject API tests without listening on a port. Cover every Phase 1 OpenAPI operation for success, validation, authentication, authorization/IDOR, public visibility, relevant 4xx/5xx responses, cookies/token exchange, and response envelopes.
20. Add operation coverage checks that compare the selected Phase 1 OpenAPI operations with API tests. Add a small real-network smoke suite only if deployment verification requires it.

## Phase 6: CI and Documentation

21. Add scripts for typecheck, formatting/linting, unit tests, Testcontainers integration tests, API/contract tests, migration reset/up, OpenAPI validation/Spectral, Markdown/link checks, and a single CI-equivalent command.
22. Add GitHub Actions with path-aware API checks; shared contract, migration, or package changes run the affected API checks. Use Node 22 and Docker/Testcontainers in CI.
23. Document local setup, test database prerequisites, Cognito test adapter behavior, migration commands, Terraform boundaries, deferred community endpoints, and the final Phase 1 contract.

## Relevant Files

- `AGENTS.md` and `.github/copilot-instructions.md` — repository authority, validation commands, and conflict rules.
- `package.json` and `package-lock.json` — add TypeScript/Fastify/Postgres/migration/test dependencies and scripts while preserving documentation tooling.
- `openapi.yaml` — reviewed OpenAPI-first Phase 1 contract.
- `docs/3-open-mic-requirements.md` — Phase 1 product behavior, permissions, registration, and page visibility.
- `docs/4-open-mic-technical-architecture.md` — index into `docs/architecture/*.md` for persistence, triggers, Fastify boundaries, and operational assumptions.
- `docs/6-open-mic-vanity-urls.md` — handle casing, redirects/quarantine, validation, reserved handles, and resolver behavior.
- `docs/decisions.md` — settled delivery order, handle rules, provenance, and explicit decisions from this planning session.
- `docs/concerns.md` — unresolved duplicate, claim, consent, retention, security, and contract issues to close before affected implementation.
- `scripts/validate-openapi.mjs`, `scripts/check-links.mjs`, `spectral.yaml`, `.markdownlint.jsonc` — existing validation conventions.
- New `apps/api/src/` — Fastify app factory, server entrypoint, plugins, config, domain modules, repositories, adapters, schemas, and routes.
- New `apps/api/migrations/` — ordered SQL/PostGIS schema, trigger functions, indexes, seeds, and node-pg-migrate metadata.
- New `apps/api/tests/unit/`, `apps/api/tests/integration/`, and `apps/api/tests/api/` — isolated test layers and fixtures.
- New `apps/api/test-support/` — Testcontainers lifecycle, migration reset, fixtures, deterministic auth identities, and external-service fakes.
- New `infra/terraform/` — AWS infrastructure definitions, kept separate from application domain code.
- New `.github/workflows/` — path-aware API CI and later deployment workflows.

## Verification

1. Run `npm run validate:openapi`, `npm run lint:openapi`, and `npm run check:links` after contract/document changes.
2. Run strict TypeScript typecheck and all DB-free unit tests on Node 22 without a database, AWS, or network.
3. Start ephemeral Postgres/PostGIS through Testcontainers, apply migrations from empty state, and run trigger/constraint/concurrency tests, including simultaneous registrations at final capacity.
4. Run Fastify.inject API tests and verify every selected OpenAPI operation has request validation, expected success shapes, ownership checks, and relevant failure behavior.
5. Run migration reset/up and the full CI-equivalent command locally; generate an operation coverage report.
6. Run Terraform formatting/validation and security checks when infrastructure work enters scope.

## Decisions

- API scope: Phase 1 only for the first executable contract; community/social endpoints are deferred.
- Authentication: Cognito in production behind an adapter; deterministic test identities in unit/API tests; no AWS calls in automated tests.
- Database testing: Testcontainers with ephemeral Postgres/PostGIS; no SQLite substitute and no shared test database as the default.
- Migrations: explicit SQL managed and ordered by node-pg-migrate.
- Registration conflicts: prevent duplicates according to the finalized identity key and allow only one successful claim; competing claims fail explicitly.
- Runtime: Node 22 LTS.
- Infrastructure: Terraform.
- Contract ownership: OpenAPI-first; implementation schemas and tests must conform to the reviewed contract.
- Compatibility: no version prefix initially; introduce a new API version only for breaking changes.
- Test runner/API testing: Vitest plus Fastify.inject rather than Jest/Supertest.
- Unit tests do not require PostgreSQL; integration tests exercise real database behavior.

## Further Considerations

1. Finalize the guest duplicate identity key: verified contact email plus event is the likely baseline, but decide how unverified/kiosk rows and same-email multiple performers behave.
2. Define exact claim/adoption authorization and transfer semantics: the verified account that claims owns later attribution changes, with organizer/admin override only if explicitly required.
3. Decide consent audit/revocation, media retention, rate limits, and external video validation before finalizing migrations and API errors.
4. Confirm whether the vanity HTML resolver belongs in the API OpenAPI document or in a separate public web/edge contract; the JSON API can still expose a resolver operation for clients.
