# Open Mic Canonical Implementation Plan

**Status:** Active  
**Last reviewed:** 2026-09-08  
**Canonical implementation plan:** this document is the repository's sequencing authority.

## 1) Purpose

This is the single implementation plan for completing the Open Mic Phase 1 product. It consolidates the still-valid backend and frontend work from the superseded plans, updates their status against the repository, and resolves their stale infrastructure assumptions through [docs/decisions.md](docs/decisions.md).

Use this plan to choose and sequence implementation work. Do not treat a screen as complete when its production API, authorization, persistence, error handling, and tests are still placeholders.

## 2) Authority and conflict handling

Implementation must follow this order of authority:

1. [docs/decisions.md](docs/decisions.md) for settled cross-document decisions.
2. [docs/3-open-mic-requirements.md](docs/3-open-mic-requirements.md) for product behavior and permissions.
3. [docs/6-open-mic-vanity-urls.md](docs/6-open-mic-vanity-urls.md) for handle lifecycle, casing, routing, and visibility.
4. [docs/4-open-mic-technical-architecture.md](docs/4-open-mic-technical-architecture.md) and its linked `docs/architecture/` documents for persistence and implementation boundaries.
5. [docs/5-open-mic-frontend-architecture.md](docs/5-open-mic-frontend-architecture.md) for frontend structure and the canonical route map.
6. [openapi.yaml](openapi.yaml) for the executable JSON API contract.
7. This plan for delivery order and completion tracking.

When authoritative sources disagree, stop and resolve the conflict in [docs/decisions.md](docs/decisions.md) before changing behavior. Do not silently choose one interpretation.

### Resolved stale assumptions

- Infrastructure is AWS CDK in `infra/`.
- The API runs on ECS Fargate, not a directly managed EC2 host.
- CloudFront and S3 host the SPA; Amplify Hosting is not used.
- Amplify is used only as the browser Cognito client SDK.
- The API remains JSON-only under `/api`; it does not render entity-specific HTML.
- Node 22 LTS, TypeScript, Fastify, PostgreSQL/PostGIS, explicit `node-pg-migrate` migrations, Vitest, Fastify injection, and Testcontainers remain the platform baseline.
- Reviews, comments, reactions, follows, messaging, social discovery, performer-authored media, and advanced public maps remain outside Phase 1.

The implementation details in [docs/architecture/development.md](docs/architecture/development.md) still describe the older EC2, db-migrate, Jest, Supertest, and frontend-directory setup. They must be updated before being used as setup or deployment instructions.

## 3) Phase 1 outcome

Phase 1 is organizer-first and is complete when:

- An organizer can sign in, select an organizer profile, create and edit an open-mic series, create and operate events, control registration, manage the roster and running order, and publish organizer-owned photos and video links.
- A guest can browse public pages, register with minimal friction, verify their email, and edit through a protected magic link.
- A signed-in performer can choose an account-owned performer profile and register without re-entering stored identity/contact data.
- An organizer can record a kiosk registration without guest email verification.
- A verified account can explicitly claim an eligible guest registration and optionally adopt an account-owned performer profile as public attribution without losing guest provenance.
- Public home, profile, open-mic, event, durable registration, and canonical handle routes enforce visibility rules.
- The production authentication, email, storage, database, hosting, authorization, observability, accessibility, and recovery paths work in staging.

The primary product measure remains registrations per event. Supporting measures should include registration completion/drop-off, repeat registrations, organizer activation, event creation, and roster-operation success. Analytics must not be added until event names, privacy rules, and a provider-neutral event vocabulary are agreed.

## 4) Current repository baseline

This status is a planning baseline, not a substitute for tests.

### Implemented or substantially implemented

**API and data**

- Fastify app factory and server entry point, structured errors, database pool/transactions, optional and required auth hooks, and the `/api` JSON boundary.
- Ordered PostgreSQL/PostGIS migrations for the core schema, handles, registration policy, songs, performances, public event codes, and profile phone storage.
- Accounts, account profiles, current-profile selection, permissions, public/private profile serialization, and profile phone storage.
- Global handle allocation and availability checks, including database-backed casing and lifecycle foundations.
- Open-mic creation, listing, public reads, owner filtering, and partial updates.
- Event creation, listing, public-code reads, next-event lookup, owner-scoped reads, and partial updates.
- Guest, authenticated performer, and organizer-supervised registration creation; capacity and duplicate enforcement; email verification; protected edit-cookie exchange; registration updates; claim/adoption; organizer roster reads; and account/profile registration reads.
- Performance creation, update, deletion, status, sequence, and organizer authorization.
- PostGIS radius filtering and authenticated LocationIQ search/reverse-geocoding proxy behavior.
- Email adapter boundary, local adapters, SQS producer, and CDK SES/SQS/Lambda email stack.
- DB-free unit tests, Fastify injection tests, and PostgreSQL/Testcontainers integration tests across the principal implemented domains.

**Frontend**

- React, TypeScript, and Vite SPA with TanStack Query, Amplify auth adapter boundary, i18n seed, theme system, responsive application shell, profile context, and local API proxy.
- Public home, profile, open-mic, event, and event-registration pages.
- Organizer dashboard, series list, event list, open-mic create/edit, and event create/edit pages.
- Guest and authenticated performer registration, registration-mode gating, confirmation state, email verification, magic-link exchange, protected editing, and local/server registration indicators.
- Claimable-registration dashboard banner with per-registration profile adoption.
- Profile editing with phone/privacy behavior.
- Reusable location picker with map, geocoding assist, manual coordinates, and progressive failure behavior.
- Twelve source-informed light/dark variants, persisted theme/mode selection, visible focus foundations, reduced-motion styles, and responsive layouts.

### Partial or not yet production-ready

- The API auth verifier now validates Cognito ID-token signatures through cached JWKS, issuer, audience/client, required claims, token use, and expiry; production Cognito configuration and staging validation remain incomplete.
- Account provisioning is idempotent on first verified sign-in, browser refresh/retry and logout cleanup are implemented, and account/profile preferences persist through the API; deployed Cognito configuration and broader frontend preference coverage remain incomplete.
- `openapi.yaml`, API routes, and frontend calls are not fully aligned.
- Public vanity resolution and canonical redirects are not wired end to end.
- Organizer roster and kiosk screens are implemented, including performance lifecycle controls, provenance states, and organizer-supervised registration.
- Claim-all behavior, a dedicated claim route, partial-failure handling, and post-claim attribution management are incomplete.
- Guest registration rate limiting and referral capture are not complete.
- Media routes, persistence service, S3 upload adapter, validation, recovery UI, and CDK storage resources are absent.
- Live roster delivery is implemented through the scoped event-roster SSE contract in [docs/decisions.md](docs/decisions.md#live-updates), using PostgreSQL `LISTEN`/`NOTIFY` fan-out and full resync on reconnect.
- The SPA still uses manual pathname matching rather than the planned TanStack Router route tree and loaders.
- Generated OpenAPI frontend types, route error boundaries, quota state, and lazy translation namespaces are absent; account locale/theme/mode synchronization and one-shot 401 refresh behavior are implemented.
- Automated frontend unit, component/integration, accessibility, and Playwright coverage is absent.
- Path-aware GitHub Actions, a single CI-equivalent command, full CDK application infrastructure, staging deployment, monitoring, and operational runbooks are absent.

## 5) Delivery rules

- Deliver vertical slices that include contract, migration, API, authorization, frontend, and tests where applicable.
- Preserve guest registration provenance separately from claimed account ownership and adopted public profile attribution.
- Preserve canonical handle casing, compare handles case-insensitively, and distinguish case-only changes from semantic renames.
- Use React Hook Form and Zod for every frontend form. Reuse shared schemas and the existing location components.
- Keep Cognito, email, S3, geocoding, analytics, and live-update providers behind adapters with deterministic test fakes.
- Use MSW only for isolated frontend tests. A mock must never conceal a missing production API operation.
- Enforce ownership and permission checks in the API, not only through hidden frontend controls.
- Public reads must serialize only visibility-safe fields. Private, hidden, blacklisted, deleted, unverified, and moderation-restricted records must follow the authoritative visibility rules.
- Prefer partial `PATCH` operations for profile and open-mic updates. Introduce a new API version only for a breaking contract change.
- Keep unit tests independent of PostgreSQL and AWS. Use real PostgreSQL/PostGIS through Testcontainers for constraints, triggers, transactions, and concurrency.
- Do not deploy AWS resources without explicit confirmation.

## 6) Detailed next steps

The milestones below are dependency ordered. A later milestone may be explored in parallel, but it must not be declared complete while an earlier production dependency remains unresolved.

### Milestone 0: Reconcile the executable contract

**Goal:** Make the selected Phase 1 routes implementable and testable without guessing.

1. Create and maintain a contract-gap matrix with one row per selected page or workflow:
   - route and canonical aliases;
   - API operation and schema;
   - authentication and active-profile requirement;
   - permission and ownership rule;
   - public visibility rule;
   - loading, empty, success, validation, conflict, quota, and failure states;
   - seed fixture;
   - unit, API, integration, component, and E2E coverage.
2. Reconcile known API mismatches:
   - decide whether event update/delete use `/events/{id}` or nested `/open-mics/{id}/events/{eventId}`, then align OpenAPI, API, and frontend;
   - decide whether `/auth/sign-up`, `/auth/sign-in`, and `/auth/refresh-token` remain JSON API operations or are removed because the browser uses Cognito through Amplify;
   - implement or remove unsupported contract operations, including account update, registration edit-token rotation, profile/open-mic/event deletion, media, and reserved-handle administration;
   - standardize pagination envelopes and list response shapes;
   - align short event IDs, canonical handles, error codes/details, quota headers, `Accept-Language`, current-profile state, and response serialization.
3. Resolve the live-update contract:
   - define a narrowly scoped organizer event/roster stream if Phase 1 requires it;
   - document authentication, reconnection, event names, ordering, heartbeat, missed-event recovery, and multi-instance fan-out;
   - otherwise make polling the explicit Phase 1 behavior and defer SSE without leaving placeholder claims.
4. Review remaining items in [docs/concerns.md](docs/concerns.md) against recorded decisions. Move resolved items into authoritative documents and retain only genuinely open concerns.
5. Add an automated OpenAPI operation-coverage report that shows which contract operations have API tests.

**Exit criteria**

- OpenAPI validation and lint pass.
- Every Phase 1 operation is either implemented and tested or explicitly assigned to a later milestone.
- No frontend route depends on an undocumented production response.
- Infrastructure and live-update wording no longer contradicts [docs/decisions.md](docs/decisions.md).

### Milestone 1: Production authentication and account state

**Goal:** Replace development identity assumptions with a secure production boundary.

1. Implement Cognito ID-token verification behind `AuthVerifier` (the client attaches the ID token, not the access token, per docs/5-open-mic-frontend-architecture.md — only the ID token carries the verified `email` claim account provisioning needs):
   - fetch and cache the configured user-pool JWKS;
   - verify signature, algorithm, issuer, expiry, token use, and configured app-client audience/client ID;
   - extract the Cognito `sub` and verified `email`;
   - reject malformed, expired, wrong-pool, wrong-client, and access-token misuse with the standard unauthorized envelope.
2. Add account provisioning for the first valid Cognito identity, including verified email handling and idempotent concurrent requests.
3. Keep deterministic injected identities for unit/API tests and simulated local development without AWS calls.
4. Complete Amplify client configuration, callback/logout URLs, refresh behavior, sign-in failure handling, and logout cache cleanup.
5. Add one-401 refresh-and-retry to the frontend API client. Retry once only; do not loop or replay unsafe requests after a failed refresh.
6. Implement `PATCH /accounts/{id}` for the account-level fields defined by OpenAPI (`display_name`, `city`, `preferred_language`). Theme and color mode are profile-level preferences, not account-level — see item 7.
7. Add profile-level preferences and mandatory onboarding:
   - add `Profiles.color_mode` (nullable, `light`/`dark`) alongside the existing `theme_name`, via migration; extend `POST /profiles` and `PATCH /profiles/{id}` to accept it;
   - add a mandatory frontend onboarding step that runs whenever a signed-in account has zero profiles: ask performer vs. organizer, plus theme/color-mode, then create the profile via `POST /profiles` and select it via `PUT /accounts/{id}/current-profile`; block other routes until this completes;
   - make the same theme/color-mode picker reusable whenever any new profile is created, not only during onboarding;
   - synchronize the theme settings page (`/settings/theme`) to read/write `theme_name`/`color_mode` on the signed-in user's current profile via `PATCH /profiles/{id}`, with saved profile preferences taking precedence over local storage once signed in, but keeping local choice usable if preference persistence fails, and retrying through a later mutation;
   - add a "set up your first open-mic" call-to-action on the organizer dashboard when the current organizer profile has no open-mic series yet (reuses `useOrganizerOpenMics`).
8. Ensure organizer navigation and route loaders rely on real permission responses and an account-owned active profile:
   - consolidate the duplicated "is this account an organizer working as a profile it owns" check into one hook (`useOrganizerProfile`, in `features/organizer.ts`), backed by the real `/me/permissions` response and the real `/accounts/{id}/profiles` list, rather than ad hoc per-page logic;
   - the open-mic and event edit forms additionally verify the resource being edited is actually owned by the active organizer profile (`owner_profile_id` match) before rendering the form, not just that the active profile has the `profiles:manage` permission in general — closes a gap where an organizer could open another organizer's edit URL by ID guessing (the API already rejected the mutation; this closes the equivalent frontend-side gap).

**Tests**

- JWT verifier unit tests for valid and invalid claims and key rotation.
- API tests for provisioning, ownership, preferences, permissions, and unauthorized responses.
- Frontend tests for sign-in transitions, refresh success/failure, logout, profile switching, and preference precedence.

**Exit criteria**

- No production request trusts an opaque bearer token as an account identifier.
- A new Cognito user can reach a provisioned account and select an owned profile.
- Authenticated preferences survive a second browser/device session.

### Milestone 2: Complete event lifecycle, roster, and kiosk operations

**Goal:** Deliver the organizer's core event-night workflow.

1. Complete event lifecycle APIs:
   - update contract/path alignment;
   - close and reopen registration where product rules permit;
   - soft-delete and recover within the uniform 30-day window;
   - enforce event location snapshot and complete-or-absent override rules;
   - enforce organizer ownership and platform-admin override explicitly.
2. Build the organizer event operations route and page:
   - visibility-safe roster rows;
   - pending/verified/kiosk/claimed provenance indicators;
   - sequence and performance status controls;
   - organizer notes;
   - performance create/edit/delete;
   - filters and empty/error states;
   - registration capacity and closure status;
   - keyboard-operable reorder or explicit sequence editing.
3. Build kiosk registration:
   - mobile/tablet-first high-contrast layout;
   - large touch targets and keyboard support;
   - rapid reset after success;
   - organizer-supervised submission;
   - no email verification requirement;
   - clear duplicate, capacity, closure, and permission errors.
4. Add polling or the Milestone 0 stream for live roster refresh, including reconnect/retry status without losing unsaved organizer changes.
5. Add organizer event links for event-specific registration and durable series registration, with copy-link and QR download controls.

**Tests**

- Integration tests for event lifecycle, registration closure, capacity races, sequence updates, and organizer isolation/IDOR.
- Component tests for roster state changes, kiosk reset, errors, and keyboard interaction.
- Playwright coverage for event creation through event-night operation.

**Exit criteria**

- An organizer can operate a seeded event from registration opening through the final running order without direct database access.
- Two organizers cannot read or mutate each other's private roster data.
- Final-place concurrent registration attempts cannot exceed capacity.

### Milestone 3: Finish registration, verification, claim, and attribution

**Goal:** Make every Phase 1 registration identity path reliable and recoverable.

1. Harden guest registration:
   - apply per-source rate limiting and return the documented `429` error;
   - preserve the decided duplicate rule: event plus verified contact email;
   - retain pending/unverified rows without allowing them to block a later verified row incorrectly;
   - expose friendly field validation and capacity/closure conflicts.
2. Finish verification and protected editing:
   - consume email verification and edit tokens once where required;
   - rotate edit tokens and invalidate previous tokens;
   - keep raw tokens out of local storage, client state snapshots, logs, referrers, and analytics;
   - rely on the scoped HttpOnly edit-session cookie after exchange;
   - support expiry and resend/recovery behavior explicitly.
3. Complete authenticated performer registration:
   - require an account-owned performer profile;
   - keep organizer and performer profiles distinct;
   - use stored performer name, city, and phone where allowed without duplicate prompts;
   - support inline performer-profile creation only through a documented account-owned API flow.
4. Complete claiming and adoption:
   - add a dedicated claim route/page as well as the dashboard banner;
   - support per-row claim and an atomic or explicitly partial claim-all operation;
   - report each claim-all conflict/failure instead of presenting false aggregate success;
   - allow explicit performer-profile adoption, no adoption, later replacement, and later removal;
   - preserve original guest provenance permanently;
   - invalidate claimable, account registration, event roster, and profile attribution queries after success;
   - preserve first-writer-wins `409` behavior for concurrent claims.
5. Implement referral behavior:
   - reusable share control on event, registration, open-mic, and profile pages;
   - Web Share API with copy-link fallback;
   - 30-day local referral storage;
   - remove `ref` from the visible URL;
   - attach a valid referral to the next registration or signed one-use OAuth state without blocking the flow.
6. Preserve media-consent audit behavior:
   - update `media_consent_updated_at` on changes;
   - make revocation future-only;
   - prevent new publication under a revoked registration;
   - do not retroactively remove already published media unless a separate moderation/deletion rule applies.

**Tests**

- Unit tests for referral expiry, token handling, error mapping, and attribution decisions.
- PostgreSQL tests for duplicate verification races and concurrent claims.
- API and frontend tests for guest, authenticated, kiosk, verify, edit, claim, claim-all, and attribution-change flows.

**Exit criteria**

- Every registration channel reaches a deterministic terminal or recoverable state.
- No raw secret token persists in browser storage or telemetry.
- Claiming never destroys or rewrites guest provenance.

### Milestone 4: Handles, canonical routes, and public browsing

**Goal:** Make public URLs durable, canonical, searchable, and visibility-safe.

1. Implement the public vanity resolver outside `/api`:
   - global profile/open-mic namespace;
   - case-insensitive lookup with canonical casing;
   - current, redirect, quarantined, reserved, available, and tombstoned behavior;
   - private/hidden/blacklisted/deleted entity visibility;
   - canonical redirect behavior from stale casing and semantic renames.
2. Implement owner handle changes and administrative reserved-handle operations if they remain in the Phase 1 contract.
3. Add frontend routes from the canonical route map:
   - profile and open-mic vanity routes;
   - durable `/open-mics/:id/register` and `/@:handle/register`;
   - nested event aliases where specified;
   - canonical redirects while retaining UUID/public-code compatibility.
4. Replace manual pathname matching with a TanStack Router route tree:
   - route-level code splitting and loaders;
   - permission-aware organizer loaders;
   - route error boundaries;
   - hover/focus prefetch;
   - focus and scroll restoration;
   - stable deep-link reload behavior.
5. Complete public discovery:
   - directory filters/search;
   - location/radius controls where Phase 1 permits;
   - localized date, time, number, and currency formatting;
   - loading, skeleton, empty, offline, retry, and quota states;
   - sticky mobile registration actions;
   - consistent accessible "coming soon" treatment for deferred social controls.
6. Add share/referral controls and organizer-owned media slots to public detail pages.

**Tests**

- Integration tests for handle casing, rename races, redirects, quarantine, reclaim, reserved names, and visibility.
- Route-helper and loader tests.
- Playwright deep-link, canonical redirect, keyboard, mobile, and offline/retry tests.

**Exit criteria**

- Every canonical and compatibility URL reloads correctly behind the static-host fallback.
- Private or moderated entities cannot be discovered through vanity resolution.
- Case-only and semantic handle changes follow distinct recorded rules.

### Milestone 5: Organizer-owned media

**Goal:** Publish recoverable, validated organizer media without exposing arbitrary uploads.

1. Implement media persistence and API routes:
   - create/get/update/soft-delete/recover;
   - profile, open-mic, and event associations;
   - owner and platform-admin authorization;
   - public visibility serialization;
   - 30-day recovery followed by purge.
2. Implement the storage adapter:
   - CDK S3 bucket and least-privilege access;
   - short-lived presigned upload requests;
   - object-key ownership and association;
   - size, MIME, extension, and image validation;
   - explicit malware-scanning decision and quarantine behavior;
   - local deterministic fake.
3. Enforce media source policy:
   - photos must reference objects in the platform media bucket through the upload flow;
   - videos must use allowlisted YouTube or Vimeo hosts;
   - arbitrary remote image/video hosts are rejected.
4. Build organizer media UI:
   - upload progress and cancellation;
   - video-link form;
   - caption and required alt-text handling;
   - target entity selection;
   - failure/retry;
   - soft-delete and recovery.
5. Respect registration media consent for event/performance associations and future publication.

**Tests**

- Validation and authorization unit/API tests.
- Adapter tests without AWS.
- Integration tests for associations, deletion/recovery, consent, and public visibility.
- Playwright happy path and failed-upload recovery.

**Exit criteria**

- An organizer can publish and recover valid media in staging.
- A user cannot attach another owner's object, bypass host restrictions, or publish against revoked consent.

### Milestone 6: Frontend system completion

**Goal:** Turn the current SPA foundation into the documented production frontend architecture.

1. Generate strict frontend request/response types from `openapi.yaml`; remove duplicate handwritten API models where generated types are suitable.
2. Formalize feature and route boundaries under `apps/web/src`, keeping shared API/auth/theme/i18n primitives independent of page components.
3. Complete i18n:
   - English bundled first;
   - all visible strings moved to resources;
   - namespace-based lazy loading;
   - locale resolution and fallback;
   - `<html lang>` updates;
   - `Accept-Language` and authenticated preference synchronization;
   - plural and long-string expansion tests.
4. Complete the design system:
   - record palette provenance, licensing, transformations, and contrast tradeoffs;
   - review all themes on public, registration, roster, kiosk, and organizer forms;
   - select a default only after side-by-side review;
   - retain at least two production-ready alternatives;
   - add Radix-backed dialogs, menus, tooltips, banners, skeletons, and toast behavior where those primitives improve accessibility.
5. Complete interaction and resilience:
   - consistent form dirty/saved/error states and unsaved-change protection;
   - route/page transitions and reduced-motion equivalents;
   - offline/retry behavior;
   - quota display;
   - accessible modal focus and status announcements;
   - no success-shaped fallback after a failed API operation.
6. Replace the template `apps/web/README.md` with actual local setup, auth, API, seed, test, locale, theme, and build instructions.

**Exit criteria**

- No production page relies on hard-coded route parsing or untranslated visible copy.
- Core workflows remain keyboard accessible and understandable with motion disabled.
- Frontend API types are checked against the executable contract.

### Milestone 7: Infrastructure, CI, staging, and operations

**Goal:** Make the application repeatably deployable and operable.

1. Extend the CDK app with bounded stacks for:
   - network and security groups;
   - ECS Fargate API service and load balancer;
   - RDS PostgreSQL/PostGIS, credentials, backups, and migrations strategy;
   - Cognito user pool/app client and callback configuration;
   - S3 media storage;
   - S3/CloudFront SPA hosting and fallback behavior;
   - existing email queue/Lambda/SES resources;
   - logs, metrics, alarms, and dead-letter monitoring.
2. Namespace stacks and configuration by environment. Begin with development/staging/production in one account, as recorded, without assuming an account-per-environment model.
3. Add GitHub Actions with OIDC federation and no long-lived AWS credentials:
   - dependency install/cache;
   - OpenAPI validation and lint;
   - API typecheck, unit, API, and Testcontainers integration tests;
   - frontend lint, typecheck, unit/integration tests, production build, and critical Playwright/accessibility checks;
   - CDK synth for infrastructure changes;
   - path-aware execution without skipping shared contract/migration/package impacts.
4. Add a single local CI-equivalent command and document prerequisites.
5. Define deployment order, migration safety, rollback, health checks, smoke tests, and environment promotion.
6. Test static hosting:
   - non-API routes return the SPA entry point;
   - `/api/*` remains JSON;
   - assets use hashed immutable URLs;
   - deep links reload correctly;
   - cache headers and invalidation are correct.
7. Add operational runbooks for:
   - failed migrations/deployments;
   - Cognito or JWKS failure;
   - database saturation;
   - registration spikes and capacity conflicts;
   - email queue backlog/DLQ;
   - failed or quarantined media;
   - geocoding rate limits/provider outage;
   - live-update degradation;
   - soft-delete purge and recovery.

**Exit criteria**

- CI proves the contract, API, database, frontend, accessibility-critical flows, and CDK synthesis.
- A clean staging environment can be provisioned and smoke-tested from documented steps.
- Alerts identify actionable failures without exposing private data.

### Milestone 8: Release hardening

**Goal:** Prove Phase 1 behavior, security, accessibility, and performance before launch.

1. Complete the test matrix:
   - DB-free unit tests for validation, authorization decisions, formatters, themes, locales, referrals, auth transitions, route helpers, and error mapping;
   - PostgreSQL/PostGIS tests for constraints, indexes, triggers, generated locations, handle transitions, registration invariants, soft-delete/recovery, and concurrency;
   - Fastify injection tests for every selected OpenAPI operation, including validation, auth, ownership/IDOR, visibility, cookies, quotas, and error envelopes;
   - RTL/MSW tests for reads, registration, verification, claim/adoption, organizer forms, kiosk, themes, and translated expansion;
   - Playwright tests for mobile and desktop public browsing, guest/authenticated registration, magic-link editing, organizer setup, roster operation, kiosk, and media.
2. Perform security review:
   - JWT and session/cookie handling;
   - authorization and IDOR;
   - registration abuse/rate limits;
   - handle impersonation/races;
   - text sanitization and XSS;
   - media upload validation and malware decision;
   - secrets/log redaction;
   - presigned URL scope/expiry;
   - consent and deletion auditability.
3. Perform accessibility review at mobile, tablet, and desktop widths:
   - WCAG AA contrast;
   - keyboard-only operation;
   - visible focus;
   - semantic names and landmarks;
   - live regions;
   - touch targets;
   - reduced motion;
   - translated string expansion.
4. Enforce performance targets from the frontend architecture:
   - initial JavaScript and route chunk budgets;
   - FCP, LCP, TTI, and CLS on throttled mobile;
   - transition timing;
   - API latency and event-night capacity tests.
5. Verify retention, recovery, purge, backup/restore, privacy-safe analytics, monitoring, and on-call ownership.

**Exit criteria**

- All release-blocking tests and audits pass in staging.
- Known limitations are documented with owners and mitigations.
- Production deployment has an approved rollback and monitoring plan.

## 7) Immediate implementation queue

Start with these independently reviewable slices:

1. **Contract parity:** produce the gap matrix and align event update/delete, auth ownership, account preferences, token rotation, media, and reserved-handle operations.
2. **Secure auth:** implement Cognito JWT verification and idempotent account provisioning with isolated tests.
3. **Account preferences:** implement the account update API and frontend locale/theme/mode synchronization.
4. **Organizer operations:** build the event roster against existing registration/performance APIs, then close missing API behavior exposed by the screen.
5. **Kiosk:** add organizer-supervised registration UI and end-to-end permission/capacity tests.
6. **Registration hardening:** add rate limiting, token rotation, dedicated claim/adoption management, and referral capture.
7. **Canonical routing:** implement the vanity resolver and migrate the SPA to TanStack Router.
8. **Media:** implement persistence/storage/CDK first, then organizer upload and recovery UI.
9. **Quality and delivery:** establish frontend tests and CI early enough that each later slice adds coverage rather than deferring it to release week.

Slices 2 and frontend test-harness setup may proceed in parallel after slice 1 settles their contracts. Media UI must not start before the storage/API contract. SSE must not start before the Milestone 0 decision.

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
npm run build:web
npm --prefix apps/web run lint
cd infra
npm run synth
```

Add and document frontend unit, integration, Playwright, accessibility, generated-contract coverage, and root CI-equivalent commands during Milestones 0, 6, and 7. Do not reintroduce Markdown linting.

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

## 10) Deferred work

The following remain outside Phase 1 unless the product requirements and API contract are explicitly expanded:

- performer-authored media and richer performer profile ownership;
- comments, reviews, reactions, follows, suggestions, and social feeds;
- private messaging and associated moderation/retention;
- advanced personalized recommendations and public map discovery;
- account deletion/export UI;
- multi-admin collaboration roles;
- multi-region, read-replica, Redis, and account-per-environment scaling.

Keep extension points clean, but do not build inactive APIs or misleading controls for deferred features.

## 11) Project risks and decision checkpoints

- **Authentication:** production organizer workflows cannot launch on the interim token lookup.
- **Contract drift:** OpenAPI, API routes, and frontend handwritten types already differ in places; generated types and operation coverage should be introduced before more surfaces accumulate.
- **Live updates:** Fargate was selected partly for SSE, but the Phase 1 stream is not contracted. Decide polling versus a scoped stream before implementation.
- **Media safety:** file validation, malware handling, consent, and purge behavior must be settled before accepting uploads.
- **Documentation drift:** [docs/architecture/development.md](docs/architecture/development.md) and parts of [docs/architecture/infrastructure.md](docs/architecture/infrastructure.md) remain stale relative to recorded decisions.
- **Frontend test debt:** no frontend automated suite currently protects the implemented registration and organizer flows.
- **Accessibility:** theme variety increases contrast and state-testing cost; production-ready themes require automated and manual review.
- **Operational readiness:** email infrastructure exists, but the rest of the deployable platform and its runbooks do not.

Review this plan after each milestone. Update current status and sequencing, but preserve settled behavior in authoritative documents rather than redefining it here.
