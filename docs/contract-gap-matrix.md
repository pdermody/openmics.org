# Phase 1 Contract-Gap Matrix

**Status:** Active working document  
**Authority:** [IMPLEMENTATION-PLAN.md](../IMPLEMENTATION-PLAN.md) for sequencing; [docs/decisions.md](decisions.md) for settled behavior; [openapi.yaml](../openapi.yaml) for the executable API contract.

This matrix records the remaining contract and coverage gaps for the selected Phase 1 workflows. A workflow is not complete until its API, authorization, visibility, failure states, fixtures, and applicable automated tests are aligned.

| Workflow | Canonical route(s) and API | Auth / ownership | Visibility / key states | Fixture and coverage status | Next contract gap |
|---|---|---|---|---|---|
| Sign-in and first profile | `/login`, `/dashboard`; Cognito plus `GET /me`, `POST /profiles`, `PUT /accounts/{id}/current-profile` | Cognito ID token; account-owned active profile | Loading, expired session, zero-profile onboarding, permission failure | API auth tests and onboarding implementation exist; broader frontend auth coverage is incomplete | Deployed Cognito validation and broader sign-in/profile-switch tests |
| Public home and browsing | `/`; `GET /events/upcoming`, `GET /open-mics` | Public reads | Exclude draft, private, hidden, deleted, quarantined, and redirected records | Seeded API/frontend surfaces exist; contract coverage needs operation audit | Align pagination, localization, quota, and offline/error states |
| Organizer series and event setup | `/open-mics/new`, `/open-mics/:id/edit`, `/open-mics/:id/events/new`, `/open-mics/:id/events/:eventId/edit`; corresponding `POST`/`PATCH` APIs | Authenticated organizer profile owning the resource | Draft/paused/published, validation, conflict, and forbidden states | API and frontend flows exist; E2E coverage is absent | Confirm delete/recovery operations and generated frontend types |
| Event roster and kiosk | `/dashboard/series/:seriesId/events/:eventId/roster`, `/kiosk`; roster, performance, kiosk-PIN, roster-stream, and registration-link APIs | Organizer or explicitly authorized collector; event ownership enforced server-side | Pending versus verified/kiosk, capacity, closure, lifecycle, IDOR, reconnect/resync, copy/QR feedback, server-PIN navigation guard | API/integration coverage and focused frontend lifecycle/kiosk/link/PIN coverage exist; full user-flow coverage is absent | Add Playwright coverage and verify every operation is represented in OpenAPI |
| Guest registration and verification | `/events/:eventId/register`; `POST /events/{id}/registrations`, `POST /registrations/{id}/verify-email` | Public create; verified email for confirmation | Validation, duplicate, capacity, closed event, email pending, resend/recovery | API/integration coverage exists; frontend automated coverage is absent | Rate limiting, token rotation, and explicit recovery behavior |
| Protected guest editing | Registration page with edit token; edit-session exchange and `PATCH /registrations/{id}` | HttpOnly edit session scoped to one registration, or authorized owner/organizer | Expired/invalid token, no-store response, conflict, save failure | Core API/frontend behavior exists; token-rotation coverage is absent | Implement and document edit-token rotation and telemetry redaction checks |
| Authenticated performer registration | Same registration route; profile-backed registration API | Signed-in account-owned performer profile | Missing performer profile, duplicate, capacity, permission, saved identity fields | Core API/frontend behavior exists; frontend automated coverage is absent | Complete inline performer-profile flow and one-401 retry behavior |
| Claim and attribution | Dashboard claim banner; dedicated `/claim-registrations`; `GET /me/claimable-registrations`, `POST /registrations/{id}/claim` | Verified account email plus an account-owned performer profile; first writer wins | No eligible rows, missing performer profile, `409` race, partial claim-all failure, profile replacement | Dedicated claim page and per-row/claim-all UI exist; claim-all response contract and partial-failure reporting remain | Define claim-all response contract and attribution mutation operations |
| Canonical handles | `/@:handle`, UUID compatibility routes; handle APIs | Public resolution; owner/admin mutations | Current, redirect, quarantined, reserved, available, tombstoned | Handle persistence exists; durable `/@:handle/register` and `/open-mics/:id/register` now resolve the next event; general vanity detail resolution and redirects remain incomplete | Implement the general resolver, redirects, visibility filtering, and route tests |
| Organizer-owned media | Public profile/open-mic/event media surfaces; media API | Owning organizer profile or platform admin | Upload validation, consent, soft-delete/recovery, quota, failure/retry | Not implemented; no production fixture | Settle storage/upload contract before UI work |

## Matrix maintenance

- Add or update a row when a Phase 1 route, API operation, permission rule, or visibility rule changes.
- Link each row to a deterministic seed fixture and the narrowest test that proves its contract.
- Mark a gap resolved only after `npm run validate:openapi`, `npm run lint:openapi`, and the relevant API/frontend checks pass.

## Coverage audit (2026-09-19)

The coverage script now strips query strings before comparing test URLs with OpenAPI path templates. This corrected false negatives caused by requests such as `/events/upcoming?limit=10`; structural coverage increased from 34/62 to 46/62 operations after adding boundary and registration lifecycle coverage.

The remaining uncovered operations are classified as follows:

| Classification | Operations | Next action |
|---|---|---|
| Implemented and boundary-tested | `listClaimableRegistrations`, `getAuthProfile`, `deleteOpenMic` | Keep focused API coverage and add success-path assertions in the owning integration suites where needed. |
| Implemented, integration-tested but not detected by the structural matcher | `listOpenMics`, `listUpcomingEvents`, `reverseGeocode`, `getMyPermissions`, `listMyRegistrations`, `resolveRegistrationEditLink` | Covered after query-string normalization; retain the integration tests as the behavioral evidence. |
| Missing route or contract entry requiring a decision | `getOpenApiDocument`, `deleteProfile` | Reconcile OpenAPI with the actual route surface before adding tests; do not claim these operations are implemented. |
| Implemented and integration-tested | `updateRegistration`, `verifyRegistrationEmail` | Keep the success-path assertions; rerun the integration suite when a Testcontainers runtime is available. |
| Intentionally deferred | Reserved-handle administration, event/profile media, media CRUD/upload, registration edit-token rotation | Keep documented as Milestones 4, 5, and 3 work; do not add placeholder tests. |