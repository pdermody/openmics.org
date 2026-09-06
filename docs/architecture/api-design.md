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

**Canonical contract:** [`openapi.yaml`](../../openapi.yaml)

**Base URL:** `https://api.openmics.org/api` (all JSON and SSE API operations are below the `/api` root)

The Fastify service serves the same contract at `GET /api/openapi.json`. Paths in the endpoint inventory below are relative to the base URL, so for example `GET /open-mics` is served at `GET https://api.openmics.org/api/open-mics`. Public HTML documents such as `/@:handle` remain outside the API root and are routed by CloudFront to the Fastify HTML origin.

**Core Resources:**

```
Authentication
  POST   /auth/sign-up            (starts Cognito hosted-UI sign-up; accepts the client-generated, signed OAuth state containing an optional referral and provisions the application Account with that referral after the validated callback)
  POST   /auth/sign-in            (delegates to Cognito)
  POST   /auth/refresh-token
  GET    /auth/profile            (current user)

Public documents (CloudFront origin for canonical handle URLs)
  GET    /@:handle                (public HTML document: escaped metadata, canonical URL, and SPA entry script)
  GET    /@:handle/events/:id     (public HTML document for an event under an open-mic handle)

Profiles (unified context management)
  GET    /accounts/:id/profiles           (list all profiles for current user with their roles)
  GET    /profiles/slug-available?slug=<candidate>   (check global profile slug availability)
  GET    /profiles/:id                    (view profile details — public or private based on permissions)
  POST   /profiles                        (create new profile)
  PUT    /profiles/:id                    (update profile — permission: profiles:edit)
  DELETE /profiles/:id                    (delete profile — permission: profiles:delete, owner only)
  PUT    /accounts/:id/current-profile    (set which profile user is currently using)
  POST   /profiles/:id/media              (add media to profile)
  GET    /profiles/:id/media              (get profile-only media)

Profile Follows ("likes")
  POST   /profiles/:id/follow             (current profile starts following :id)
  DELETE /profiles/:id/follow             (current profile unfollows :id)
  GET    /profiles/:id/followers          (list profiles that follow :id)
  GET    /profiles/:id/following          (list profiles :id follows)
  GET    /me/following/upcoming-events    (upcoming events from every profile the current profile follows;
                                           supports ?limit=&from=&to=; ordered by date/time ascending)

Profile Access Management
  GET    /profiles/:id/members            (list all accounts and their roles — permission: profiles:manage_roles)
  POST   /profiles/:id/invitations        (invite account with role — permission: profiles:manage_roles)
  GET    /profiles/:id/invitations        (list pending invitations — permission: profiles:manage_roles)
  PUT    /invitations/:id                 (accept/reject invitation by recipient)
  DELETE /profiles/:id/members/:account_id  (remove account's access — permission: profiles:manage_roles)
  PUT    /profiles/:id/members/:account_id/role  (change account's role — permission: profiles:manage_roles)

Roles & Permissions (post-MVP, platform admin only)
  GET    /roles                           (list all roles)
  GET    /permissions                     (list all permissions)
  POST   /roles                           (create new role — permission: roles:create)
  PUT    /roles/:id                       (update role — permission: roles:edit)
  GET    /roles/:id/permissions           (list permissions for a role)
  POST   /roles/:id/permissions           (add permission to role — permission: roles:edit)
  DELETE /roles/:id/permissions/:perm_id  (remove permission from role — permission: roles:edit)

OpenMics (directory + management)
  GET    /open-mics                  (directory search — see "Directory search & map endpoints" below)
  GET    /open-mics/map              (map view: pins or clusters within a bounding box)
  POST   /open-mics                  (authenticated; the caller's current profile becomes the owning organizer profile)
  GET    /open-mics/slug-available?slug=<candidate>   (check global slug availability)
  GET    /open-mics/:id
  PUT    /open-mics/:id
  GET    /open-mics/:id/events
  GET    /open-mics/:id/next-event    (public; the soonest upcoming, not-yet-closed event under the series, or null + schedule_summary/schedule_details fallback; powers the durable "next event" QR/link)
  GET    /open-mics/:id/register      (public HTML; resolves to the next event's register page via /open-mics/:id/next-event, or renders the schedule_summary fallback if none exists; also served at the vanity form /@:handle/register)
  GET    /open-mics/:id/events/slug-available?slug=<candidate>   (check per-series event slug availability)
  GET    /open-mics/:id/reviews
  POST   /open-mics/:id/reviews   (registered users only)

Events
  GET    /events/upcoming         (public; ordered by date/time ascending; supports ?near=<lat>,<lng>&radius_km=&limit=&from=&to=; used by the directory home "Upcoming events" section)
  GET    /events/:id
  POST   /events                  (organizer only; requires open_mic_id; defaults location from the open mic but accepts location overrides for a one-off venue)
  PUT    /events/:id
  GET    /events/:id/registrations                (organizer/assistant view of the roster; also backs the walk-in kiosk state)
  POST   /events/:id/registrations                (self-serve or kiosk; body sets submission_channel, organizer_supervised, referred_by_profile_id, contact_email, etc.)
  GET    /events/:id/reviews
  POST   /events/:id/reviews
  GET    /events/:id/media         (grouped by added_by_role: organizer | performer)
  POST   /events/:id/media         (organizer or registered performer, using current profile)

Registrations
  GET    /registrations/:id                        (owner — profile or claiming account — or organizer/assistant of the event)
  GET    /registrations/edit?token=<edit_token>    (magic-link resolve for guest edits; no auth required)
  PUT    /registrations/:id                        (owner or organizer/assistant, or the short-lived edit session established by the magic-link resolver)
  POST   /registrations/:id/rotate-edit-token      (owner or organizer/assistant; invalidates the previous magic link and emails a new one)
  POST   /registrations/:id/verify-email           (public; body/query carries the one-shot verification token; flips a pending self-serve guest row to valid)
  POST   /registrations/:id/claim                  (authenticated; claims a guest registration whose contact_email matches the caller's Cognito-verified email)
  GET    /registrations/:id/performances

Me
  GET    /me/claimable-registrations               (authenticated; lists unclaimed guest registrations whose contact_email matches the caller's Cognito-verified email, excluding pending self-serve rows)
  GET    /me/home/upcoming-events                  (authenticated; personalized upcoming-events feed for the directory home — prioritizes followed profiles, prior registrations, and attended open mics; falls back to nearest then soonest globally; supports ?near=&limit=)
  GET    /me/home/notable-open-mics                (authenticated; personalized "notable open-mics" feed with the same priority order and fallbacks; supports ?near=&limit=)

Performances
  POST   /performances             (create performance for a registration)
  PUT    /performances/:id
  DELETE /performances/:id

Media
  GET    /media/:id
  POST   /media/upload-url        (presigned upload URL)
  POST   /media                   (create media record, associated with current profile)
  DELETE /media/:id               (soft delete)
  POST   /media/:id/recover       (from recycle bin, using current profile)
  GET    /media/:id/comments
  POST   /media/:id/comments      (using current profile)
  GET    /media/:id/reactions
  POST   /media/:id/reactions     (using current profile)

Comments
  GET    /comments/:id
  PUT    /comments/:id             (edit text/rating; author only)
  DELETE /comments/:id
  POST   /comments/:id/replies    (using current profile)

EventReviews
  GET    /events/:id/reviews/:reviewId
  PUT    /events/:id/reviews/:reviewId              (edit text/rating; reviewer only)
  DELETE /events/:id/reviews/:reviewId
  POST   /events/:id/reviews/:reviewId/responses   (organizer's profile only)

OpenMicReviews
  GET    /open-mics/:id/reviews/:reviewId
  PUT    /open-mics/:id/reviews/:reviewId              (edit text/rating; reviewer only)
  DELETE /open-mics/:id/reviews/:reviewId
  POST   /open-mics/:id/reviews/:reviewId/responses   (organizer's profile only)

PrivateMessages
  GET    /messages                (inbox for current profile)
  POST   /messages/:profile_id    (send from current profile to recipient profile)
  GET    /messages/:profile_id    (conversation with specific profile)
  PUT    /messages/:id/mark-read

Suggestions (site-wide suggestion box — platform/product feedback only, never about a specific open mic, event, or profile)
  GET    /suggestions                         (list; supports ?status=&tag=&sort=top|new; public read)
  POST   /suggestions                         (authenticated account posts a suggestion)
  GET    /suggestions/:id                     (view a suggestion)
  PUT    /suggestions/:id                     (edit title/body/tags — author only)
  PATCH  /suggestions/:id/status              (change status — platform admin only)
  PUT    /suggestions/:id/admin-notes         (update admin_notes — platform admin only)
  DELETE /suggestions/:id                     (soft delete — author or platform admin)
  GET    /suggestions/:id/replies             (list replies through CommentSuggestions)
  POST   /suggestions/:id/replies             (add a reply, using current profile)
  GET    /suggestions/:id/reactions           (upvotes)
  POST   /suggestions/:id/reactions           (upvote, using current profile)

Notifications
  GET    /notifications/stream    (SSE endpoint)
  GET    /notifications           (unread list)
  PUT    /notifications/:id/read
```

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

**Rate Limiting:**
- 100 requests/min per user (CloudWatch + API Gateway rules later)
- 10 requests/min for media uploads

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

**CTAs on the home page** (rendered above the two feeds):

- **Signed in** with `open_mics:create` on any of their profiles: a **Register a new open mic** button, and for every open mic the caller can manage, an **Add an event to *〈open-mic-name〉*** button.
- **Signed in** without those permissions: no create CTAs (their `/dashboard` already carries any actions relevant to their role).
- **Anonymous:** a prominent **Sign up** button and a secondary **Sign in** link, with one-line copy explaining what an account unlocks (following organizers, personalized recommendations, claiming past registrations).

---
