# Open Mic Feature Plan

**Status:** Active
**Last reviewed:** 2026-09-30
**Scope:** Phase 1 feature-level plan. Smaller per-slice implementation plans should live alongside the work they cover and defer sequencing/authority questions to this document.

## 1) Purpose

This plan tracks the features still required to launch Phase 1. Items that have shipped and are covered by tests are removed; the current implementation baseline lives in the code, [`openapi.yaml`](openapi.yaml), and the migrations under [`apps/api/migrations/`](apps/api/migrations). Refer to [docs/contract-gap-matrix.md](docs/contract-gap-matrix.md) for per-workflow coverage detail.

## 2) Authority

Feature planning must follow this order of authority:

1. [docs/decisions.md](docs/decisions.md) for settled cross-document decisions.
2. [docs/3-open-mic-requirements.md](docs/3-open-mic-requirements.md) for product behavior and permissions.
3. [docs/6-open-mic-vanity-urls.md](docs/6-open-mic-vanity-urls.md) for handle lifecycle, casing, routing, and visibility.
4. [docs/4-open-mic-technical-architecture.md](docs/4-open-mic-technical-architecture.md) plus its linked `docs/architecture/` documents for persistence and implementation boundaries.
5. [docs/5-open-mic-frontend-architecture.md](docs/5-open-mic-frontend-architecture.md) for frontend structure and the canonical route map.
6. [`openapi.yaml`](openapi.yaml) for the executable JSON API contract.
7. This feature plan for delivery order and completion tracking of remaining Phase 1 features.

Smaller implementation plans written alongside individual slices inherit from this document; when they conflict with it, update this plan or resolve the disagreement in [docs/decisions.md](docs/decisions.md) rather than silently choosing an interpretation.

## 3) Phase 1 outcome

Phase 1 is organizer-first and is complete when:

- An organizer can sign in, select an organizer profile, create and edit an open-mic series, create and operate events, control registration, and manage the roster and running order.
- A guest can browse public pages, register with minimal friction, verify their email, and edit through a protected magic link — including rotating that link if it is lost.
- A signed-in performer can choose an account-owned performer profile and register without re-entering stored identity/contact data.
- An organizer can record a kiosk registration without guest email verification, and a walk-in can self-register via the kiosk's event QR.
- A verified account can explicitly claim an eligible guest registration and optionally adopt an account-owned performer profile as public attribution without losing guest provenance.
- Public home, profile, open-mic, event, durable registration, and canonical handle routes enforce visibility rules and redirect stale/retired handles to the canonical URL.
- An organizer can upload photos and add video links to their profile, open-mic series, and events, subject to source-policy enforcement, quotas, and 30-day soft-delete recovery.
- The production authentication, email, database, hosting, authorization, observability, accessibility, and recovery paths work in staging under CI.

The primary product measure remains registrations per event. Supporting measures should include registration completion/drop-off, repeat registrations, organizer activation, event creation, and roster-operation success. Analytics must not be added until event names, privacy rules, and a provider-neutral event vocabulary are agreed.

## 4) Delivery rules

- Deliver vertical slices that include contract, migration, API, authorization, frontend, and tests where applicable.
- Preserve guest registration provenance separately from claimed account ownership and adopted public profile attribution.
- Preserve canonical handle casing, compare handles case-insensitively, and distinguish case-only changes from semantic renames.
- Use React Hook Form and Zod for every frontend form. Reuse shared schemas and the existing location components.
- Keep Cognito, email, geocoding, and live-update providers behind adapters with deterministic test fakes.
- Use MSW only for isolated frontend tests. A mock must never conceal a missing production API operation.
- Enforce ownership and permission checks in the API, not only through hidden frontend controls.
- Public reads must serialize only visibility-safe fields.
- Prefer partial `PATCH` for partial resource updates. Introduce a new API version only for a breaking contract change.
- Keep unit tests independent of PostgreSQL and AWS. Use real PostgreSQL/PostGIS through Testcontainers for constraints, triggers, transactions, and concurrency.
- Do not deploy AWS resources without explicit confirmation.

## 5) Next up

Independently reviewable slices, roughly dependency-ordered:

1. **Organizer-owned media.** Settle operational policy decisions (MIME allowlist, file-size cap, malware/AV scanning, presigned URL expiry) in [docs/decisions.md](docs/decisions.md), land the S3 CDK stack, then implement the schema, API, source-policy enforcement, upload adapter, and organizer upload/recover UI.
2. **Registration hardening:** guest-registration rate limiting, edit-token rotation, referral capture end to end.
3. **Vanity finalization:** server-side canonical redirects and reserved-handle admin.
4. **Directory & public UX polish:** public directory filters/search, sticky mobile registration actions, coming-soon treatment for deferred social controls.
5. **Frontend platform completion:** generated OpenAPI types, per-namespace i18n, design-system audit, README rewrite.
6. **Infrastructure, CI, staging:** complete CDK stacks (API, RDS, Cognito, SPA hosting, monitoring), OIDC-federated GitHub Actions, staging deploy + smoke.
7. **Release hardening:** security, accessibility, and performance reviews plus the full test matrix.
8. **Staging validation of production auth:** deployed Cognito user pool + app client and end-to-end verification.

Slices 1–5 can be worked in parallel across API/web tracks once slice 1's policy decisions and CDK bucket are landed. Slice 6 must precede slice 8; slice 7 finishes before launch.

## 6) Remaining workstreams

The workstreams below are the remaining Phase 1 scope. Everything referenced here is either not built or built but not yet validated in staging under CI.

### A) Organizer-owned media

**Prerequisites (settle before code lands).**

- **Operational policy** in [docs/decisions.md](docs/decisions.md): MIME allowlist, per-file size cap, per-account/per-open-mic quota, malware/AV scanning decision (scan vs. quarantine vs. reject), presigned URL scope + expiry + rotation. Currently open per [docs/concerns.md](docs/concerns.md).
- **S3 CDK stack** in [`infra/lib/`](infra/lib): media bucket, least-privilege IAM for the API task role, CORS for presigned uploads, lifecycle/deletion policy, CloudFront delivery, and its wiring into [`infra/bin/infra.ts`](infra/bin/infra.ts).
- **Rate limiting primitive.** Upload endpoints need per-account and per-source limits. If workstream B's registration limiter lands first, share it; otherwise ship the primitive here.

**Implementation.**

1. **Migration.** Add `Media` and `PendingS3Deletions` schemas (currently in [docs/architecture/data-model.md → Post-MVP appendix](docs/architecture/data-model.md#media-pipeline-post-mvp-schema)). Promote both back into the Phase 1 schema section of that document as part of the slice.
2. **Storage adapter behind an interface**, with a local deterministic fake for unit/API tests:
   - short-lived presigned upload URLs (owner-authenticated only);
   - server-generated object keys bound to owner + target entity (never client-supplied);
   - size, MIME, extension, and image-dimension validation on the create/complete step;
   - malware/AV integration or quarantine per the decisions above.
3. **API routes** per [`openapi.yaml`](openapi.yaml) (`/media`, `/media/upload-url`, `/media/{id}`, `/media/{id}/recover`, `/profiles/{id}/media`, `/events/{id}/media`):
   - create/get/update/soft-delete/recover;
   - profile, open-mic, and event associations;
   - owner and platform-admin authorization;
   - public visibility serialization;
   - 30-day recovery followed by purge, using the same per-table soft-delete pattern as events/performances/registrations.
4. **Source-policy enforcement** ([decisions.md → Media](docs/decisions.md#media)):
   - photos must reference objects in the platform media bucket via the upload flow;
   - videos must use allowlisted YouTube or Vimeo hosts;
   - arbitrary remote image/video hosts are rejected.
5. **Organizer upload UI:**
   - upload progress and cancellation;
   - video-link form;
   - caption and required alt-text handling;
   - target-entity selection;
   - failure/retry;
   - soft-delete and recovery.
6. **Registration media consent.** Enforce `Registrations.media_consent` (future-only, per [decisions.md → Guest Registrations](docs/decisions.md#guest-registrations)) when associating media with event/performance rows.
7. **Public serialization.** Public reads of profile/open-mic/event pages surface only visibility-safe media rows; soft-deleted, quarantined, and consent-revoked media stay hidden.

**Tests**

- Unit/API: validation, authorization, source-policy enforcement, consent gating, soft-delete/recovery.
- Storage adapter tests without AWS (local fake).
- Integration: associations across profile/open-mic/event, deletion/recovery window, consent revocation, public visibility.
- Playwright: happy path plus failed-upload recovery.

**Exit criteria**

- An organizer can publish and recover valid media in staging.
- A user cannot attach another owner's object, bypass host restrictions, or publish against revoked consent.
- Every media-related operation in [`openapi.yaml`](openapi.yaml) is covered by API tests and reported by `npm run coverage:openapi`.

### B) Contract parity

1. Track the remaining OpenAPI/route mismatches in [docs/contract-gap-matrix.md](docs/contract-gap-matrix.md):
   - reconcile `getOpenApiDocument` and `deleteProfile` (route vs. contract);
   - keep the operation-coverage script running against every merged change.
2. Fail CI on OpenAPI validation, lint, and operation-coverage regression (moves under workstream G once CI exists).

### C) Registration hardening

1. **Guest registration rate limiting.** Apply per-source (IP + `contact_email`) limits on `POST /events/{id}/registrations` and return the documented `429` envelope. Reject rate-limited traffic before the pending-row insert so abuse cannot fill the verification-token table.
2. **Edit-token rotation.** Implement `POST /registrations/{id}/rotate-edit-token` (currently in [`openapi.yaml`](openapi.yaml) with no route): invalidate the previous hash, mint and email a new token, and expose a "resend my edit link" action on the registration edit page and organizer roster row.
3. **Referral capture end to end.**
   - Frontend: capture `?ref=<profile_id>` on any shareable public page, persist it locally for 30 days, strip it from the visible URL after capture.
   - Registration: attach the stored referral to `POST /events/{id}/registrations` as `referred_by_profile_id`. Column and validation already accept it; the client-side capture path is missing.
   - Account sign-up: place the stored referral in a signed, single-use Cognito OAuth `state` value; validate and consume it in Fastify while first-provisioning the account.
   - Silently ignore unrecognized/expired/missing values on both paths.
4. **Reusable share control.** Web Share API with copy-link fallback on event, registration, open-mic, and profile pages so the referral link has an obvious source.
5. **Media-consent audit surface.** `Registrations.media_consent_updated_at` already tracks changes; ensure the registration edit UI surfaces revocation with copy that reflects future-only semantics.

**Tests**

- Unit: referral expiry/storage, edit-token hashing/rotation, rate-limit error mapping.
- PostgreSQL: rate-limit accounting under contention; concurrent-rotation races.
- API/frontend: rotation-triggered flows, referral attribution to a registration, referral survival across the sign-up round trip.

### D) Vanity URLs and public directory

1. **Server-side canonical redirects (outside `/api`).** Fastify serves the SPA fallback for non-API paths today; add explicit 301s that redirect UUID URLs, retired-handle casings, and quarantined/redirect states to the current canonical `/@handle` URL before falling back to the SPA. Rules follow [docs/6-open-mic-vanity-urls.md](docs/6-open-mic-vanity-urls.md).
2. **Reserved-handle admin CRUD.** Implement `/admin/reserved-handles*` (currently in OpenAPI with no route) so platform admins can add/remove reserved handles at runtime without redeploying. Enforce platform-admin authorization from the `accounts` table, not from a JWT claim.
3. **Public directory filters/search.** Extend the home/public browse experience to expose the filter and sort surface documented in [docs/architecture/api-design.md](docs/architecture/api-design.md#directory-search--map-endpoints) (`q`, `country`/`city`, `activity`, `tag`, `min_rating`, `registration_mode`, `sort`). The API already supports these params; the UI does not.
4. **UX polish on public detail pages.**
   - Localized date/time/number/currency formatting audit.
   - Sticky mobile registration action on event, registration, open-mic, and profile pages.
   - Consistent, accessible "coming soon" treatment for deferred social controls (comments, reviews, follows, messaging).

**Tests**

- Integration: canonical/UUID/retired-handle redirect matrix, reserved-name enforcement, quarantine/tombstone visibility.
- Frontend: directory filter interactions, empty/loading/error states, mobile sticky action behavior.
- Playwright: deep-link reload behind static hosting, canonical redirect on stale URLs.

### E) Frontend platform completion

1. **Generated API types.** Generate strict request/response types from [`openapi.yaml`](openapi.yaml) into `apps/web/src/api/generated/` and migrate handwritten models where the generated shape fits. Keep the handwritten wrapper's error taxonomy on top.
2. **i18n namespaces.** Split the single `common` bundle per locale into per-feature namespaces (directory, dashboard, openMic, event, errors, ...) with lazy loading; keep English bundled with the shell for fallback. Both `en` and `es` currently ship as one namespace each.
3. **Design-system audit.**
   - Record palette provenance, licensing, and contrast tradeoffs for the shipped themes; select a default only after side-by-side review; retain at least two production-ready alternatives.
   - Adopt Radix primitives (dialog, dropdown, tooltip, select) consistently where they improve accessibility; the packages are already installed.
   - Review every theme against the public, registration, roster, kiosk, and organizer form surfaces.
4. **Interaction and resilience audit.**
   - Consistent form dirty/saved/error state and unsaved-change protection across every RHF+Zod form.
   - Route/page transitions plus reduced-motion equivalents.
   - Offline/retry behavior and a shared quota banner primitive (no `Accounts.plan` today, but the `QUOTA_EXCEEDED` envelope is stable — see [api-design.md](docs/architecture/api-design.md#5-api-architecture)).
   - No success-shaped fallback after a failed API operation.
5. **Docs.** Replace the template [`apps/web/README.md`](apps/web/README.md) with actual local setup, auth, API, seed, test, locale, theme, and build instructions.

**Exit criteria**

- No production page relies on hard-coded route parsing or untranslated visible copy.
- Core workflows remain keyboard-accessible with motion disabled.
- Frontend API types are checked against the executable contract in CI.

### F) Production auth deployment

Cognito ID-token verification, JWKS caching, and idempotent account provisioning are implemented behind `AuthVerifier`; deployed Cognito configuration and staging validation are the remaining work.

1. Provision the production/staging Cognito user pool and app client via CDK ([`infra/lib/auth-stack.ts`](infra/lib/auth-stack.ts) is the current shape); configure callback/logout URLs, MFA policy, and hosted-UI branding.
2. Wire the deployed `COGNITO_*` values into the API and web builds.
3. Validate the end-to-end sign-in / sign-out / profile-switch flow against staging.
4. Broaden frontend automated coverage of sign-in transitions, one-401 refresh-and-retry, logout cache cleanup, and preference precedence (server preference wins once signed in; local choice survives a preference-persistence failure).

### G) Infrastructure, CI, and operations

Existing CDK stacks: network, database, auth, email (SQS+Lambda+SES), API (Fargate), migration (one-off Fargate task), certificate, and frontend (S3+CloudFront). No CI pipeline exists (`.github/` contains only `copilot-instructions.md` and `prompts/`).

1. **CDK completion.**
   - Add or verify monitoring/alarm/DLQ resources (CloudWatch alarms on API 5xx, DLQ depth, RDS CPU/IOPS, SES bounces).
   - Confirm SPA hosting fallback behavior (non-API routes serve `index.html`; `/api/*` remains JSON; hashed immutable asset URLs; CloudFront invalidation strategy).
   - Namespace stacks by environment (`OPENMIC_ENVIRONMENT` and CDK context) for `dev`, `staging`, `prod`, per [decisions.md → Infrastructure](docs/decisions.md#infrastructure).
2. **GitHub Actions with OIDC federation to AWS.** No long-lived AWS credentials in repo secrets.
   - Path-aware jobs for API (`typecheck:api`, `test:unit`, `test:api`, `test:integration`), web (lint, typecheck, unit, build, Playwright + a11y), OpenAPI (validate/lint/coverage), CDK synth.
   - Do not skip shared contract/migration/package impacts when computing path filters.
3. **Single local CI-equivalent command.** Runs the same checks a maintainer would run locally before pushing.
4. **Deployment discipline.** Document deployment order, migration safety, rollback, health checks, and staging smoke tests. The migration task runs as its own Fargate step, not on API boot.
5. **Operational runbooks.**
   - Failed migrations/deployments.
   - Cognito or JWKS failure.
   - Database saturation.
   - Registration spikes and capacity conflicts.
   - Email queue backlog / DLQ.
   - Geocoding rate limits / provider outage.
   - Live-update degradation (SSE stream failure, PostgreSQL `LISTEN`/`NOTIFY` drops).
   - Soft-delete purge and recovery.

**Exit criteria**

- CI proves the contract, API, database, frontend, accessibility-critical flows, and CDK synth on every merge.
- A clean staging environment can be provisioned and smoke-tested from documented steps.
- Alerts identify actionable failures without exposing private data.

### H) Release hardening

Broad-front hardening once the workstreams above are landed.

1. **Test matrix completion.**
   - DB-free unit tests for validation, authorization decisions, formatters, themes, locales, referrals, auth transitions, route helpers, and error mapping.
   - PostgreSQL/PostGIS tests for constraints, indexes, triggers, generated location columns, handle transitions, registration invariants, soft-delete/recovery, and concurrency.
   - Fastify injection tests for every selected OpenAPI operation, including validation, auth, ownership/IDOR, visibility, cookies, and error envelopes.
   - RTL/MSW tests for reads, registration, verification, claim/adoption, organizer forms, kiosk, themes, and translated expansion.
   - Playwright for mobile/desktop public browsing, guest/authenticated registration, magic-link editing, organizer setup, roster operation, and kiosk. Today the only spec is [`apps/web/e2e/organizer-critical-workflow.spec.ts`](apps/web/e2e/organizer-critical-workflow.spec.ts).
2. **Security review.**
   - JWT and session/cookie handling.
   - Authorization and IDOR across profiles/events/registrations.
   - Registration abuse and rate limits (once workstream C ships).
   - Handle impersonation/races.
   - Text sanitization and XSS.
   - Secrets/log redaction (bearer tokens, edit tokens, stream tokens, kiosk PINs).
   - Consent and deletion auditability.
3. **Accessibility review** at mobile, tablet, and desktop widths:
   - WCAG AA contrast across every shipped theme.
   - Keyboard-only operation and visible focus.
   - Semantic names, landmarks, and live regions.
   - Touch targets and reduced motion.
   - Translated string expansion.
4. **Performance targets.**
   - Initial JavaScript and route chunk budgets from [docs/5-open-mic-frontend-architecture.md](docs/5-open-mic-frontend-architecture.md).
   - FCP, LCP, TTI, CLS on throttled mobile.
   - Transition timing and reduced-motion equivalents.
   - API latency budgets and an event-night capacity test.
5. **Retention, backup, and privacy.**
   - Purge sweep for expired registration verification tokens and 30-day soft-delete rows.
   - Backup/restore rehearsal from staging.
   - Privacy-safe analytics decision recorded in [decisions.md](docs/decisions.md).

**Exit criteria**

- All release-blocking tests and audits pass in staging.
- Known limitations are documented with owners and mitigations.
- Production deployment has an approved rollback and monitoring plan.

## 7) Deferred work

These items are explicitly outside Phase 1. Do not build inactive APIs or misleading controls for them.

- Performer-authored media and richer performer profile ownership.
- Comments, reviews, reactions, follows, suggestions, and social feeds.
- Private messaging and its moderation/retention model.
- Advanced personalized recommendations and public map discovery (`/open-mics/map`).
- Account deletion/export UI and the two-stage account lifecycle.
- Multi-admin collaboration roles (`Roles`, `Permissions`, `AccountProfileRoles`, `ProfileInvitations`).
- Multi-region, read-replica, Redis, and account-per-environment scaling.

Schema references for the deferred surface live in [docs/architecture/data-model.md → Post-MVP appendix](docs/architecture/data-model.md#post-mvp-appendix).

## 8) Verification commands

Use the narrowest relevant checks while developing, then the complete release checks at milestone boundaries.

```text
npm run validate:openapi
npm run lint:openapi
npm run check:links
npm run coverage:openapi
npm run typecheck:api
npm run test:unit
npm run test:api
npm run test:integration
npm --prefix apps/web run lint
npm --prefix apps/web run test
npm --prefix apps/web run build
cd infra && npm run build && npm run synth
```

Add and document frontend Playwright, accessibility, generated-contract coverage, and a root CI-equivalent command during workstreams E and G. Do not reintroduce Markdown linting.

## 9) Definition of done for a slice

A slice is complete only when:

- behavior matches the authoritative requirements and recorded decisions;
- OpenAPI matches the implemented request, response, status, error, auth, and permission behavior;
- migrations are ordered, reversible where practical, and tested from an empty database;
- API authorization prevents cross-account/profile/entity access;
- frontend loading, empty, validation, conflict, offline, permission, and server-failure states are intentional;
- accessibility and reduced-motion behavior are covered at the appropriate level;
- unit, API, integration, and user-flow tests cover the changed risk;
- local seed data makes the flow repeatable;
- documentation and setup instructions are current;
- no mock, local token shortcut, or success-shaped fallback is mistaken for production behavior.

## 10) Project risks and decision checkpoints

- **Media policy is unresolved.** Workstream A cannot start without settled MIME/size/AV/expiry decisions in [docs/decisions.md](docs/decisions.md) and the corresponding S3 CDK stack. Starting the code before these settle produces churn and a brittle security surface.
- **Contract drift.** OpenAPI, API routes, and handwritten frontend types still differ in places; generated types (workstream E) plus CI coverage (workstream G) close this before it grows.
- **No CI.** Every check listed in [§8](#8-verification-commands) currently depends on maintainer discipline. Ship workstream G before scaling delivery — media (workstream A) adds meaningful deploy surface area and should not roll out under manual verification.
- **Rate-limit / abuse surface.** Guest registration, edit-link resends, and media uploads are all abuse surfaces. Workstream C covers registration and edit links; workstream A carries the upload surface. Do not launch without both.
- **Handle takeover surface.** Retired-handle 301s and reserved-handle admin (workstream D) close a small but real impersonation window.
- **Accessibility.** Theme variety increases contrast and state-testing cost; production-ready themes require automated and manual review under workstream H.
- **Operational readiness.** Email infrastructure exists; the rest of the deployable platform and its runbooks do not.

Review this plan after each workstream. Update current status and sequencing here, but preserve settled behavior in authoritative documents rather than redefining it in this plan.
