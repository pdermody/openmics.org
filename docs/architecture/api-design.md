# API Design

**Related:** [../4-open-mic-technical-architecture.md](../4-open-mic-technical-architecture.md)

---

## Deferred (later-phase) API surface

`openapi.yaml` contains only the Phase 1 executable contract. The following were removed from the contract (not the product) and can be restored from git history when their phase begins:

- **Follows and follow-dependent feeds** (Phase 2+ social): `/profiles/{id}/follow`, `/profiles/{id}/followers`, `/profiles/{id}/following`, `/me/following/upcoming-events`, `/me/home/upcoming-events`, `/me/home/notable-open-mics`, and the `Follow`/`ProfileFollow` schemas.
- **Reviews**: all `*/reviews*` operations on open-mics and events, and the `Review*` schemas.
- **Comments and reactions**: `/media/{id}/comments`, `/media/{id}/reactions`, `/reactions/{id}`, `/comments/*`, and the `Comment*`/`Reaction*` schemas.
- **Private messaging**: `/messages*` and the `PrivateMessage` schema.
- **Suggestions** (site-wide feedback box): `/suggestions*` and the `Suggestion*` schemas.
- **Notifications** (depend on the above): `/notifications*` and the `Notification` schema.
- **Multi-admin collaboration roles** (explicitly post-MVP per the data model): `/profiles/{id}/roles`, `/profiles/{id}/members*`, `/profiles/{id}/invitations`, `/invitations/{id}`, `/roles*`, `/permissions`, and the `Role`/`Permission`/`AccountProfileRole`/`ProfileInvitation` schemas.
- **Public map/geo discovery** (Phase 3): `/open-mics/map` and the `MapResult`/`MapPin`/`MapCluster` schemas.
- **Legacy slug system**, superseded by handles: `/profiles/slug-available`, `/open-mics/slug-available`, `/open-mics/{id}/events/slug-available`, the `Slug` parameter, and the `slug` fields on `Profile`, `OpenMic`, and `Event` (the Phase 1 database schema has no `events.slug` column at all).

The public vanity resolver (`GET /@:handle`) intentionally does not appear in `openapi.yaml` — it is served outside the `/api` base by Fastify directly, per [6-open-mic-vanity-urls.md](../6-open-mic-vanity-urls.md#10-api-surface).

---

## 5) API Architecture

**Canonical contract:** [`openapi.yaml`](../../openapi.yaml) is the single source of truth for paths, methods, parameters, request/response schemas, status codes, and authentication for the Phase 1 API. The Fastify service serves the same document at `GET /api/openapi.json`.

**Base URL:** `https://api.openmics.org/api`. All JSON and SSE API operations live below the `/api` root; for example `GET /open-mics` is served at `GET https://api.openmics.org/api/open-mics`. Browser-facing paths remain outside the API root and receive the shared SPA entry point — the API does not render entity-specific HTML.

**Contract conventions** (not repeated in this document — see `openapi.yaml`):

- Partial resource updates use `PATCH` (profiles, open-mics, events, registrations, accounts). `PUT` is reserved for wholesale-replace operations such as `PUT /accounts/{id}/current-profile`.
- Browser authentication is Cognito ID tokens issued through Amplify. There are no `/auth/sign-up`, `/auth/sign-in`, or `/auth/refresh-token` operations on this API — the browser talks to Cognito directly.
- Phase 1 SSE is scoped to the organizer event-roster stream (`GET /events/{id}/roster/stream`) plus its stream-token mint endpoint. See [decisions.md → Milestone 2 event lifecycle](../decisions.md#milestone-2-event-lifecycle) for the token, ordering, resync, and multi-instance fan-out contract.
- Handles are resolved outside `/api` by the vanity resolver (`GET /@:handle`), per [6-open-mic-vanity-urls.md](../6-open-mic-vanity-urls.md#10-api-surface).

For anything not covered by `openapi.yaml`, prefer [decisions.md](../decisions.md), [../contract-gap-matrix.md](../contract-gap-matrix.md), and this document's Directory search, Home page feed, Personalization, and Geocoding sections below.

**Error Response Format:**
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid input",
    "details": [{"field": "email", "reason": "already_exists"}]
  }
}
```

Quota errors use the same envelope with a stable `code` so the frontend can catch them uniformly:
```json
{
  "error": {
    "code": "QUOTA_EXCEEDED",
    "message": "Storage limit reached.",
    "dimension": "media_bytes",
    "current": 5368709120,
    "limit": 5368709120,
    "upgrade_url": "https://openmics.org/billing"
  }
}
```

Quotas themselves are a post-MVP concept — see [data-model.md → Post-MVP appendix](data-model.md#post-mvp-appendix) for the current unimplemented model. The stable error envelope is retained so the frontend can react to a `QUOTA_EXCEEDED` code without a follow-up contract change when quotas ship.

**Rate limiting** in Phase 1 is applied by the API to specific abuse surfaces (guest registration, geocoding proxy). A generic per-user request budget is not implemented; document any additions in `openapi.yaml` and this section together.

**Directory search & map endpoints:**

`GET /open-mics` — the directory query, used by the public directory home and any "browse open mics" surface. All params are optional and combine freely:

- `q` — full-text against `name`, `description`, `venue_name`, `city`, `schedule_summary`. Uses Postgres's `simple` tsvector config for now (language-agnostic; localization is deferred).
- `country=IE`, `city=Cork` — exact match.
- `activity=singing,poetry` — matches when `OpenMics.activities` overlaps the requested set (`&&` on the GIN index).
- `tag=all-ages,acoustic` — same shape on `OpenMics.tags`.
- `near=<lat>,<lng>&radius_km=<n>` — `ST_DWithin(location, ST_MakePoint(lng, lat)::geography, radius_km*1000)`. Uses the GIST index on `OpenMics.location`.
- `min_rating=<0..5>` — filters on `rating_avg`.
- `registration_mode=on_platform|external|any` — `on_platform` returns rows where `registration_mode IN ('pre_only','on_night_only','both')`; `external` returns only `registration_mode='external'`; default `any`.
- `sort=nearest|rating|recent|updated|popular` — default is `nearest` when `near=…` is set, otherwise `recent`. `recent` sorts by `created_at DESC` (newest listings first — used by the home page "Notable open-mics" section). `updated` sorts by `updated_at DESC` (a signal of active organizer management). `popular` sorts by `rating_avg` weighted by `log(rating_count + 1)` so a 5-star listing with one review doesn't outrank a 4.6-star listing with fifty.
- `page`, `page_size` — page/limit for MVP; cursor pagination if the list grows.

Always excludes `status IN ('draft','ended')` and `deleted_at IS NOT NULL`. `paused` rows are returned with an `on_break: true` flag so cards can show "On break" without dropping the entry from search results. Response items are a summary shape (`{ id, handle, name, city, country, rating_avg, rating_count, activities, tags, schedule_summary, registration_mode, entry_fee_amount, entry_fee_currency, entry_fee_note, primary_photo_url, distance_km? }`) — deliberately smaller than `GET /open-mics/:id` so the list renders fast.

`GET /me/open-mics` — the authenticated organizer-dashboard listing (owner_profile_id required, must belong to the caller's account). Unlike `GET /open-mics`, this endpoint does **not** filter by status: it returns every non-deleted series owned by the profile, including `draft` and `ended`, so an organizer can see and manage a series they just created before it's published. Follows the `GET /me/permissions` / `GET /me/registrations` pattern of account-scoped endpoints rather than adding undocumented owner filters to the public directory query.

`GET /open-mics/map` — for the interactive map on the directory home:

- `bbox=<west>,<south>,<east>,<north>` — required; longitude/latitude bounding box.
- `zoom=<0..20>` — required; drives the pins-vs-clusters decision.
- Filters: `activity`, `tag`, `min_rating`, `registration_mode` — same semantics as the search endpoint.

Response shape depends on zoom:
- **High zoom (≥ 12, roughly city level):** array of individual pins `{ id, handle, name, lat, lng, activities, rating_avg }`, capped at a few hundred. If the bbox contains more, the response includes `truncated: true` and the client falls back to the cluster view.
- **Lower zoom:** aggregated clusters computed server-side via `ST_ClusterKMeans` (or a grid snap for very large result sets). Each cluster returns `{ lat, lng, count, sample_ids }`; `sample_ids` powers the fly-out preview when a cluster is clicked.

Both endpoints send `Cache-Control: public, max-age=60`; the edge layer warms fast, invalidation on write is unnecessary because the URL varies by query string and 60 s freshness is well inside product tolerance.

**Home page feed rules (`/` directory home):**

The public `/` route lays out two sections — **Upcoming events** and **Notable open-mics**, five cards each — above the interactive map and search surface. The endpoint powering each section switches based on auth and geolocation permission:

| State | Upcoming events source | Notable open-mics source |
|---|---|---|
| Anonymous, location off | `GET /events/upcoming?limit=5` | `GET /open-mics?sort=recent&limit=5` |
| Anonymous, location on  | `GET /events/upcoming?near=<lat>,<lng>&radius_km=100&limit=5` | `GET /open-mics?near=<lat>,<lng>&sort=nearest&limit=5` |
| Signed in, location off | `GET /me/home/upcoming-events?limit=5` | `GET /me/home/notable-open-mics?limit=5` |
| Signed in, location on  | `GET /me/home/upcoming-events?near=<lat>,<lng>&limit=5` | `GET /me/home/notable-open-mics?near=<lat>,<lng>&limit=5` |

Both sections render an empty state on zero rows ("No upcoming events" / "No open mics found") and each renders independently — a slow or empty query in one section never blocks the other.

**Personalization for signed-in requests** (`/me/home/*`). The server scores every candidate row against the caller's account/profile context using four EXISTS-style predicates and sorts on those signals before falling back to distance/recency. Signals evaluated:

1. **Followed** — the open mic's owning organizer profile is followed by any of the caller's profiles (`ProfileFollows`).
2. **Registered** — the caller has any `Registrations` row for an event on this open mic, resolved via `profile_id IN (my profiles) OR claimed_by_account_id = my account`.
3. **Attended** — a `Performances` row with `status='performed'` exists on any of the caller's registrations for this open mic.
4. **Distance** — `ST_Distance(location, near)` when a `near` param is provided; NULL otherwise.
5. **Recency** — `created_at` for open mics, `date` for events.

Sort order: `is_followed DESC, has_registered DESC, has_attended DESC, dist_m ASC NULLS LAST, recency`. A single CTE-backed query builds the score set from the base table plus the three EXISTS predicates — cheap enough to serve inline without cache warming. A brand-new signed-in account with no signals degrades naturally to distance/recency — the same output an anonymous caller with the same location settings would get.

**Location handling.** The client requests `navigator.geolocation.getCurrentPosition()` behind a small explanatory prompt on first visit, caches the result in `sessionStorage` for the session, and sends it as `near=` on every home request. If the user declines or the browser denies, the client omits `near=` and the endpoint falls back cleanly. There is no server-side IP geolocation for MVP.

---

## Geocoding

`GET /geocoding/search?q=<address>` and `GET /geocoding/reverse?lat=<num>&lng=<num>` back the organizer-facing map/location picker embedded in the OpenMic and Event create/edit forms (see [../research/open-mic-map-location-picker.md](../research/open-mic-map-location-picker.md) for the options considered). Both are authenticated (`profiles:manage`-adjacent org tooling, not public) and proxy [LocationIQ](https://locationiq.com/):

- **Backend proxy, never a browser-held key.** The LocationIQ API key lives only in the API's `LOCATIONIQ_API_KEY` config and is never sent to the client. The frontend calls `/geocoding/*` on this API, which forwards to LocationIQ server-side.
- **Shared rate-limit throttling.** LocationIQ's free tier caps requests at ~2/sec *per account*, shared across every concurrent app user — not per-user. The proxy implements an in-process token-bucket throttle (`apps/api/src/geocoding/service.ts`) so the app as a whole stays within quota; once the local queue is saturated or LocationIQ itself returns `429`, the endpoint returns `429 GEOCODING_RATE_LIMITED` rather than queuing indefinitely.
- **Graceful frontend degradation.** The reusable `LocationPicker` component and `useGeocoding` hook (`apps/web/src/components/location/`, `apps/web/src/features/location.ts`) disable the address-lookup assist for the rest of the session on a `GEOCODING_RATE_LIMITED` response (or a `503 GEOCODING_UNAVAILABLE`), logging the event via a pluggable reporter. The map's draggable pin and the always-present, keyboard-accessible numeric latitude/longitude inputs keep working with zero API calls regardless of assist availability — coordinates only ever reach the database from those two paths, never invented client-side.
- Both endpoints share the standard error envelope; see `openapi.yaml` for the full request/response schema (`GeocodeCandidate`, `GeocodingRateLimited`, `GeocodingUnavailable`).

---

**CTAs on the home page** (rendered above the two feeds):

- **Signed in** with `open_mics:create` on any of their profiles: a **Register a new open mic** button, and for every open mic the caller can manage, an **Add an event to *〈open-mic-name〉*** button.
- **Signed in** without those permissions: no create CTAs (their `/dashboard` already carries any actions relevant to their role).
- **Anonymous:** a prominent **Sign up** button and a secondary **Sign in** link, with one-line copy explaining what an account unlocks (following organizers, personalized recommendations, claiming past registrations).

---
