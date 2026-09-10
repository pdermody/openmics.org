# Contract Gap Matrix

**Status:** Milestone 0 complete — [IMPLEMENTATION-PLAN.md](../IMPLEMENTATION-PLAN.md)
**Last generated:** 2026-09-08
**Last reconciled:** 2026-09-09

## Purpose

This matrix is the working artifact for [Milestone 0](../IMPLEMENTATION-PLAN.md#milestone-0-reconcile-the-executable-contract). It records, per canonical page/workflow from [docs/5-open-mic-frontend-architecture.md](5-open-mic-frontend-architecture.md), the actual implemented API operation, auth/permission/visibility rules, UI state coverage, seed fixtures, and test coverage — as found in the repository on the date above. It is a snapshot, not a spec; when it disagrees with an authoritative document, the authoritative document wins and this file should be corrected.

Legend: ✅ implemented and matches contract · ⚠️ implemented but diverges from contract/plan · ❌ not implemented · — not applicable / deferred.

## How this was produced

Findings below come from direct inspection of `openapi.yaml`, `apps/api/src/**/routes.ts`, and `apps/web/src/App.tsx` on this date. Test coverage columns are marked from file presence only (`apps/api/test/**`, `apps/web/src/**/*.test.*`); they are not a substitute for running the suites.

---

## Public / auth

| Page/workflow | Route (frontend) | Canonical route (docs 5) | API operation | Auth | Permission/ownership | Visibility | States covered | Seed fixture | Tests | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| Directory home | `/` | `/` | `GET /open-mics`, `GET /events/upcoming` | none | — | public-safe fields only | loading/empty/success | yes (dev seed) | API tests exist for list ops | ✅ |
| Sign-in | none | `/login` | Cognito (Amplify) | — | — | — | ❌ not built | — | — | ❌ Amplify sign-in flow incomplete (Milestone 1) |
| Sign-up | none | `/register` | Cognito (Amplify) | — | — | — | ❌ not built | — | — | ❌ same as above |
| Signed-in dashboard | `/dashboard` | `/dashboard` | `GET /me`, `GET /me/permissions` | required | self only | private | loading/empty/success | partial | some | ✅ route exists, gating relies on interim auth |

## Open-mic series

| Page/workflow | Route (frontend) | Canonical route (docs 5) | API operation | Auth | Permission/ownership | Visibility | States | Seed | Tests | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| Series details | `/open-mics/:id` | `/open-mics/:id` | `GET /open-mics/:id` | none | — | public fields | loading/empty/success | yes | yes | ✅ |
| Create series | `/dashboard/series/new` | `/open-mics/new` | `POST /open-mics` | required | organizer profile auto-created | — | success/validation | yes | yes | ⚠️ route path diverges from canonical map (`/dashboard/series/new` vs `/open-mics/new`) |
| Edit series | `/dashboard/series/:id/edit` | `/open-mics/:id/edit` | `PATCH /open-mics/:id` | required | owner or platform admin | — | success/validation/403 | yes | yes | ⚠️ same route divergence; no DELETE (soft-delete) implemented |

## Events

| Page/workflow | Route (frontend) | Canonical route (docs 5) | API operation | Auth | Permission/ownership | Visibility | States | Seed | Tests | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| Event detail | `/events/:eventId` | `/open-mics/:id/events/:eventId` | `GET /events/:id`, `GET /open-mics/:id/events/:eventId` | none | — | public fields | loading/empty/success | yes | yes | ⚠️ frontend uses flat `/events/:eventId`, not nested canonical route |
| Create event | `/dashboard/series/:id/events/new` | `/open-mics/:id/events/new` | `POST /open-mics/:id/events` | required | owner of series | — | success/validation | yes | yes | ⚠️ route path divergence only |
| Edit event | `/dashboard/series/:id/events/:eventId/edit` | `/open-mics/:id/events/:eventId/edit` | `PATCH /events/:id` | required | owner or platform admin | — | success/validation/403 | yes | yes | ✅ resolved in Milestone 0: implementation moved to flat `/events/{id}` to match `openapi.yaml`. No DELETE/soft-delete yet. |
| Event roster (organizer) | `/dashboard/series/:id` (list only) | `/open-mics/:id/events/:eventId` (roster panel) | `GET /events/:id/registrations` | required | event owner | private | list only, no roster UI | partial | API test only | ❌ no dedicated roster page/UI exists yet (Milestone 2) |
| Public self-registration | `/events/:eventId/register` | `/events/:eventId/register` | `POST /events/:id/registrations` | optional | — | n/a | loading/validation/success/capacity/duplicate | yes | yes | ✅ path matches canonical map |
| Durable next-event registration | none | `/open-mics/:id/register`, `/@:handle/register` | `GET /open-mics/:id/next-event` (API exists) | none | — | n/a | ❌ not built | — | API-only | ❌ frontend route absent |
| Kiosk / walk-in registration | none | `/events/:eventId/collect` | `POST /events/:id/registrations` (reusable, no dedicated kiosk mode) | required (`registrations:collect`) | organizer/assistant | n/a | ❌ not built | — | none | ❌ Milestone 2 |

## Profiles

| Page/workflow | Route (frontend) | Canonical route (docs 5) | API operation | Auth | Permission/ownership | Visibility | States | Seed | Tests | Notes |
|---|---|---|---|---|---|---|---|---|---|---|
| All profiles for account | none | `/accounts/:id/profiles` | `GET /accounts/:id/profiles` | required | self or platform admin | private | ❌ no dedicated page (profile switching lives in dashboard/profile-context) | partial | API test only | ⚠️ API exists, no standalone route |
| Create profile | via profile-context UI | `/profiles/new` | `POST /profiles` | required | self | — | success/validation | yes | yes | ⚠️ no dedicated `/profiles/new` route; created inline |
| Profile details | `/profiles/:id` | `/profiles/:id` | `GET /profiles/:id` | none | — | public/private serialization | loading/empty/success | yes | yes | ✅ |
| Edit profile | `/profiles/:id/edit` | `/profiles/:id/edit` | `PATCH /profiles/:id` | required | owner | — | success/validation/403 | yes | yes | ✅ |

## Media (Milestone 5 — not started)

| Page/workflow | Route (frontend) | Canonical route (docs 5) | API operation | Notes |
|---|---|---|---|---|
| Media detail | none | `/media/:id` | `GET /media/{id}` (OpenAPI only) | ❌ no route implementation anywhere; OpenAPI documents `POST /media`, `/media/upload-url`, `/media/{id}`, `/media/{id}/recover` but none exist in `apps/api/src` |
| Media upload | none | `/media/upload` | `POST /media/upload-url`, `POST /media` (OpenAPI only) | ❌ not implemented; no S3 adapter, no CDK storage stack |
| Media edit | none | `/media/:id/edit` | `PATCH /media/{id}` (OpenAPI only) | ❌ not implemented |

## Auth/account operations documented in OpenAPI but not implemented in the API

| OpenAPI operation | Status | Notes |
|---|---|---|
| `PATCH /accounts/{id}` | ❌ not implemented | needed for Milestone 1 preference sync (language/theme/mode); method corrected from `PUT` to `PATCH` in Milestone 0 |
| `POST /registrations/{id}/rotate-edit-token` | ❌ not implemented | needed for Milestone 3 token rotation |
| `GET/PUT /admin/reserved-handles`, `/admin/reserved-handles/{handle}` | ❌ not implemented | Milestone 4 |
| `POST /media`, `GET/PATCH/DELETE /media/{id}`, `POST /media/upload-url`, `POST /media/{id}/recover` | ❌ not implemented | Milestone 5 |
| `GET /events/{id}/media`, `GET /profiles/{id}/media` | ❌ not implemented | Milestone 5 |

`/auth/sign-up`, `/auth/sign-in`, and `/auth/refresh-token` were removed from `openapi.yaml` in Milestone 0 (see [decisions.md → Milestone 0 contract reconciliation](decisions.md#milestone-0-contract-reconciliation)); the browser talks to Cognito directly through Amplify. `GET /auth/profile` remains implemented and unaffected.

`PUT /registrations/{id}` was changed to `PATCH /registrations/{id}` in Milestone 0, for the same partial-update reason as profiles/open-mics/accounts.

## Known route-path divergences between frontend and canonical map (docs 5)

The SPA currently uses ad hoc pathname matching (`apps/web/src/App.tsx`) rather than the canonical route map. These are not contract-breaking (no API mismatch) but must be resolved before or during the TanStack Router migration (Milestone 4, item 4):

- `/dashboard/series` used instead of a route under `/open-mics`
- `/dashboard/series/new` instead of `/open-mics/new`
- `/dashboard/series/:id/edit` instead of `/open-mics/:id/edit`
- `/dashboard/series/:id` (event list) instead of `/open-mics/:id/events`
- `/dashboard/series/:id/events/new` instead of `/open-mics/:id/events/new`
- `/dashboard/series/:id/events/:eventId/edit` instead of `/open-mics/:id/events/:eventId/edit`
- `/events/:eventId` used instead of nested `/open-mics/:id/events/:eventId`
- No `/@:handle` vanity routes exist yet (Milestone 4)
- No `/login`, `/register`, `/profiles/new`, `/accounts/:id/profiles`, `/media/*`, `/events/:eventId/collect`, `/open-mics/:id/register` routes exist yet

## Auth verifier status (blocks Milestone 1)

`apps/api/src/auth/verifier.ts` treats the bearer token as a raw `accounts.cognito_id` value and performs a direct database lookup. It does not validate a Cognito JWT signature, issuer, audience/client, token use, or expiry. This is called out explicitly in the file's own comment and confirms the plan's Milestone 1 problem statement — no code change was needed to verify this, only reading the file.

## Milestone 0 status

All five Milestone 0 items are complete:

1. This matrix (above).
2. Known API mismatches reconciled: event update/delete moved to flat `/events/{id}` `PATCH`; `/auth/sign-up|sign-in|refresh-token` removed from `openapi.yaml`; `PUT /registrations/{id}` and `PUT /accounts/{id}` changed to `PATCH`. See [decisions.md → Milestone 0 contract reconciliation](decisions.md#milestone-0-contract-reconciliation) for the full record and rationale.
3. Live-update contract defined: a single organizer event-roster SSE stream (`GET /events/{id}/roster/stream`, token issuance via `POST /events/{id}/roster/stream-token`), documented in `openapi.yaml` and [decisions.md → Live updates](decisions.md#live-updates). Not yet implemented — that's Milestone 2 work.
4. [docs/concerns.md](concerns.md) reviewed against `decisions.md`; resolved items moved there with pointers, only genuinely open items remain.
5. `npm run coverage:openapi` reports which `openapi.yaml` operations have at least one matching test call in `apps/api/tests/**`. As of this pass: 23/56 operations have matching test coverage — the gap is almost entirely the not-yet-implemented operations listed above (media, admin, auth/account update, edit-token rotation, roster stream), which is expected at this stage.

## Next steps

- Re-generate or hand-update this matrix after each milestone that changes routes, as instructed in IMPLEMENTATION-PLAN.md section 11.
- Milestone 1 (production Cognito auth) is next per IMPLEMENTATION-PLAN.md's dependency order.

