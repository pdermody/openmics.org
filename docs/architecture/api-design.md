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

**Public series event browsing:** `GET /open-mics/{id}/public-events` is a separate, public-only operation; the organizer array operation is unchanged. `period=upcoming|past`, `page` and `page_size` (default 10), optional `year` and `month` (requires year) filter published events of an active series. Running events lead Upcoming; future events are nearest first, Past newest first, with stable ID tie-breaks. Year/month match venue-local start dates. The response contains `items`, `pagination` (`page`, `page_size`, `total`) and `available_years` for the entire chosen period.

**Public media views:** shared media item/list/featured operations accept `public_view=true` to enforce public visibility even for owners. Management defaults retain staging access. Paused parents are hidden from every public gallery, including derived performer media, individual media JSON and OG. Public tabs are Photos/Videos; `type=all` remains an internal API capability, not a public tab.

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

Public discovery excludes draft, paused, ended and deleted series. Paused series and their events/media are unavailable publicly; organizer management access is unchanged. Response items are a summary shape (`{ id, handle, name, city, country, rating_avg, rating_count, activities, tags, schedule_summary, registration_mode, entry_fee_amount, entry_fee_currency, entry_fee_note, primary_photo_url, distance_km? }`) — deliberately smaller than `GET /open-mics/:id` so the list renders fast.

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

The public `/` route previews three upcoming events and three open-mic series. Anonymous and signed-in browsing use the same public visibility boundary; personalized `/me/home/*` feeds and public map discovery remain deferred.

- Previews use `GET /events/upcoming` and paginated `GET /open-mics`. With an origin, both send the same `near` and `radius_km`, initially 50 km. Without one, show general results.
- `GET /discovery/suggestions` calculates the smallest wider radius reaching 20 additional active public series, with a 200 km ceiling. Positive smaller inventories are offered at 200 km; zero inventory produces no expansion action. Counts use the current-radius annulus and include boundary ties.
- Suggestions contain cities with their own public series and use city-centre distance ordering. Choosing one resets the radius to 50 km.
- `/discover` uses numbered pagination across Open mics/Upcoming events tabs. Series use `GET /open-mics`; events use the additive paginated `GET /events/discovery`, preserving the existing `/events/upcoming` array contract.
- Sections load and fail independently. Suggestion failures do not conceal valid results or appear as successful empty searches.
- Browser location is requested only with permission or an explicit user action, falling back to a resolved saved city. Geographic overrides live only for the active app instance and restore with in-app history; refresh resets them. There is no IP geolocation.

**City lookup:** `GET /cities/search` returns bounded catalogue matches ranked by exact/prefix/other relevance, then population, with country and region. `GET /cities/{id}` resolves one place. The catalogue preserves Unicode/ASCII spellings and stable source IDs; it is not a public bulk-data export.

`POST /cities/search-external` is an explicit city-only LocationIQ fallback. Repeated queries/confirmed places are cached within provider terms, and a shared atomic daily budget limits actual outgoing requests. Normal typing, catalogue searches and result browsing do not call the provider.

Nullable selected-city references supplement existing text snapshots on accounts, series, events and registrations. The API resolves selected identities, validates country consistency and preserves partial-update/unlink semantics. Ambiguous legacy strings remain unresolved rather than selecting the most populous match. See [decisions.md](../decisions.md#city-catalogue-and-public-discovery).

---

## Geocoding

`GET /geocoding/search?q=<address>` and `GET /geocoding/reverse?lat=<num>&lng=<num>` back the organizer-facing map/location picker embedded in the OpenMic and Event create/edit forms (see [../research/open-mic-map-location-picker.md](../research/open-mic-map-location-picker.md) for the options considered). Both are authenticated (`profiles:manage`-adjacent org tooling, not public) and proxy [LocationIQ](https://locationiq.com/):

- **Backend proxy, never a browser-held key.** The LocationIQ API key lives only in the API's `LOCATIONIQ_API_KEY` config and is never sent to the client. The frontend calls `/geocoding/*` on this API, which forwards to LocationIQ server-side.
- **Shared cost/rate boundary.** External city fallback shares the configured provider budget with organizer geocoding. A daily cap is reserved atomically across API instances; throttling and bounded requests protect the provider rate limit. Exhaustion/provider `429` is returned explicitly, not as an empty candidate list.
- **Graceful frontend degradation.** The reusable `LocationPicker` and `useGeocoding` disable address assist on rate-limit/unavailable errors and report them explicitly. Manual pin/coordinate editing remains usable. Catalogue city selection can seed an initial pin, but the organizer must confirm or refine it before saving as a venue location.
- Both endpoints share the standard error envelope; see `openapi.yaml` for the full request/response schema (`GeocodeCandidate`, `GeocodingRateLimited`, `GeocodingUnavailable`).

---

**CTAs on the home page** (rendered above the two feeds):

- **Signed in** with `open_mics:create` on any of their profiles: a **Register a new open mic** button, and for every open mic the caller can manage, an **Add an event to *〈open-mic-name〉*** button.
- **Signed in** without those permissions: no create CTAs (their `/dashboard` already carries any actions relevant to their role).
- **Anonymous:** sign-up/sign-in actions explain Phase 1 account benefits such as registration and claiming eligible past registrations, not deferred follows or personalized recommendations.

---
