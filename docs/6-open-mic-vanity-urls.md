# Open Mic Vanity URLs

**Status:** Draft
**Date:** 2026-08-23
**Related:** [4-open-mic-technical-architecture.md](4-open-mic-technical-architecture.md), [5-open-mic-frontend-architecture.md](5-open-mic-frontend-architecture.md)

---

## 1) Summary

Friendly, shareable URLs are a first-class priority. Every profile and every open-mic series has a **handle** — a short human-readable identifier — that lives at the root of the domain under a single `@` prefix:

- `openmics.org/@paul-dermody` — performer or organizer profile
- `openmics.org/@portlaoise-spotlight-sessions` — open-mic series
- `openmics.org/@nighttown-galway` — open-mic series
- `openmics.org/@sarah-organizes` — organizer profile

Both entity types share **one global handle namespace**. Handles are the **canonical public URL** for these entities; UUID-based URLs still work but 301-redirect to the handle URL. Events do **not** get handles in v1 — they inherit the parent series' handle in their URL.

Rationale (short version): this is the Instagram / Twitter / Threads model. Users don't need to be taught what an `@` URL is. One prefix means one reserved-word list, one resolver, one mental model. Symmetric across both entity types means the router, the follow feed, and the share-sheet UI are all uniform.

The `/ask` design conversation that produced this decision is in commit history.

---

## 2) URL Scheme

### Canonical URLs

| Entity | Canonical URL |
|---|---|
| Profile (performer or organizer) | `openmics.org/@:handle` |
| Open-mic series | `openmics.org/@:handle` |
| Event under a series | `openmics.org/@:handle/events/:eventId` |
| Next-scheduled-event registration (durable link/QR) | `openmics.org/@:handle/register` — resolves server-side to the soonest upcoming event's register page, or shows the series' schedule summary if none is open |
| Media on a profile or event | `openmics.org/media/:mediaId` *(no handle — internal id only)* |

### Alternate URLs (still work, 301 to canonical)

| Alternate | Redirects to |
|---|---|
| `openmics.org/profiles/:id` (UUID) | `openmics.org/@:current_handle` |
| `openmics.org/open-mics/:id` (UUID) | `openmics.org/@:current_handle` |
| `openmics.org/@:retired_handle` | `openmics.org/@:current_handle` |
| Case variant `@:Handle` | Canonical stored casing `@:handle` |
| Trailing slash `@:handle/` | No trailing slash `@:handle` |

### What's **not** getting a handle in v1

- **Events.** They're dated recurrences of a series. The parent series handle + event id (or event date) is the natural share unit. Adding event-level handles later is cheap; retracting them is not.
- **Media.** Individual audio/video clips stay UUID-only. There's no user demand for `openmics.org/@my-favourite-song`.
- **Suggestions, comments, messages, notifications.** Internal navigation surfaces.
- **Accounts.** Accounts are login containers, not public identities. Only their **profiles** are public.

---

## 3) Handle Namespace and Uniqueness

**One global namespace across both entity types.** A single handle cannot simultaneously belong to a profile and an open-mic series. Consequences:

- The uniqueness check is a single unique index, not a cross-table constraint.
- The resolver never has to disambiguate — one handle → one entity, always.
- The auto-generator hits `-2`/`-3` suffixes marginally sooner in a shared namespace than in per-type namespaces. Acceptable trade for the simplicity.
- Redirected handles (see [§7](#7-rename-policy--redirect--quarantine-flow)) are temporary and automatically reclaimable after the quarantine period ends.
- Handle comparisons are case-insensitive for lookup and uniqueness, but the original casing selected by the user is preserved as the canonical handle display string.

---

## 4) Data Model

Single `Handles` table is the source of truth. Denormalized `current_handle` column on `Profiles` and `OpenMics` acts as a read cache.

```
Handles
├── handle                 (PK — canonical public string as entered by the user; case-preserving)
├── entity_type            ("profile" | "open_mic" | NULL when available/reserved/tombstoned)
├── profile_id             (FK → Profiles.id, nullable — set when entity_type='profile')
├── open_mic_id            (FK → OpenMics.id, nullable — set when entity_type='open_mic')
├── status                 ("current" | "redirect" | "quarantined" | "reserved" | "available" | "tombstoned")
├── redirects_to_handle    (nullable — set while the prior handle is in the 30-day redirect window)
├── redirect_expires_at    (nullable)
├── quarantine_expires_at  (nullable)
├── reserved_category      (nullable — populated only when status='reserved'; e.g. "route", "infra", "future", "impersonation", "numeric")
├── reserved_reason        (nullable — free-text audit note populated only when status='reserved')
├── created_at
├── retired_at             (nullable)
├── created_by_profile_id  (FK, nullable — for audit)
├── created_by_admin_id    (FK to Accounts, nullable — set when status='reserved' is inserted by a platform admin)
# UNIQUE INDEX (lower(handle)) — enforces case-insensitive uniqueness across all handle statuses
# INDEX (profile_id) WHERE status = 'current' AND profile_id IS NOT NULL
# INDEX (open_mic_id) WHERE status = 'current' AND open_mic_id IS NOT NULL
# INDEX (status) WHERE status = 'reserved'    -- cheap admin listings
# CHECK: exclusive arc — entity_type pins exactly one of the two FK columns, so profile_id/open_mic_id can never disagree with entity_type or with each other:
#   (entity_type = 'profile'  AND profile_id IS NOT NULL AND open_mic_id IS NULL)
#   OR (entity_type = 'open_mic' AND open_mic_id IS NOT NULL AND profile_id IS NULL)
#   OR (entity_type IS NULL AND profile_id IS NULL AND open_mic_id IS NULL)
# CHECK: status = 'current'       → redirects_to_handle IS NULL AND entity_type IS NOT NULL
# CHECK: status = 'redirect'      → redirects_to_handle IS NOT NULL AND entity_type IS NOT NULL AND redirect_expires_at IS NOT NULL
# CHECK: status = 'quarantined'   → entity_type IS NOT NULL AND redirects_to_handle IS NOT NULL AND quarantine_expires_at IS NOT NULL
# CHECK: status = 'reserved'      → entity_type IS NULL AND redirects_to_handle IS NULL
# CHECK: status = 'available'     → entity_type IS NULL AND redirects_to_handle IS NULL
# CHECK: status = 'tombstoned'    → entity_type IS NULL AND redirects_to_handle IS NULL
# CHECK: (reserved_category IS NOT NULL OR reserved_reason IS NOT NULL) → status = 'reserved'
```

`profile_id` and `open_mic_id` are real, database-enforced foreign keys — unlike a single polymorphic `entity_id` column, Postgres itself guarantees every populated reference points at a row that actually exists, and the exclusive-arc `CHECK` guarantees exactly one of the two is ever set, matching `entity_type`.

**Denormalization on the entity tables:**

```
Profiles
├── … existing columns …
├── current_handle      (FK → Handles.handle ON UPDATE CASCADE, unique — existence enforced by the FK; the additional invariant that the referenced row has status='current' and profile_id=Profiles.id is enforced by the same trigger that maintains this column, not by the FK itself)

OpenMics
├── … existing columns …
├── current_handle      (FK → Handles.handle ON UPDATE CASCADE, unique — same pattern: FK guarantees the handle exists, the maintaining trigger guarantees it is this entity's current row)
```

`current_handle` is a read cache — a trigger on `Handles` updates it on the owning `Profiles`/`OpenMics` row in the same transaction whenever a write makes that row the entity's new `current` handle (rename, initial creation, or restore). Reads never have to join.

**Interaction with soft-delete:** handles survive soft-delete of their entity. `status` stays `current`; the row is not touched. When the parent is restored, the handle resumes working transparently. When the parent is hard-deleted by the purge job, the handle transitions to `tombstoned` and stops resolving to anything — but the row remains so the handle can never be re-registered by someone else.

---

## 5) Handle Validation Rules

Enforced identically at create and rename, in the API (Zod schema shared with the frontend form via `openapi.d.ts`).

- **Character set:** `^[A-Za-z0-9][A-Za-z0-9-]{1,48}[A-Za-z0-9]$`
  - ASCII letters, digits, hyphens
  - **3–50 characters (inclusive).** The required first + last alphanumerics plus at least one middle character enforce the 3-char minimum in the regex itself; every 1- and 2-character handle is rejected by validation, so no single- or double-letter row is ever inserted into `Handles` and no reservation is needed to hold that space.
  - Must start and end with alphanumeric (no leading/trailing hyphen)
  - No consecutive hyphens (`--`)
- **Not all-digits.** `123456` shouldn't look like a UUID/id.
- **Not a UUID shape.** Reject anything matching `^[0-9a-f]{8}-…$` — prevents deliberate confusion with the alternate UUID form.
- **Not a reserved word.** Enforced by the presence of a `Handles` row with `status='reserved'`; the same normalized uniqueness index that catches "already in use" catches reservations. No separate list lookup.
- **Not already in use** (including redirect handles, quarantined handles, and tombstoned handles).
- **ASCII only for v1.** Non-ASCII opens a homograph attack surface (`рaul-dermody` with Cyrillic `р`) that requires NFKC normalization + confusable-detection to defend properly. Defer.

**Canonicalization and case handling.** Every place a handle enters the system — create/rename forms, availability checks, the URL router, the reserved-handles admin API — the input is trimmed and compared using a case-insensitive normalized key. The original casing chosen by the user is preserved as the canonical public handle. If a user creates `@Paul-Dermody`, the canonical public URL is `@Paul-Dermody` and the system stores that exact casing as the canonical handle. A request for `openmics.org/@paul-dermody` resolves to the same entity because comparisons ignore case.

**Display is case-preserving.** The stored handle remains exactly as created, and the canonical public handle keeps that casing. This means `@Paul-Dermody` and `@paul-dermody` resolve to the same profile, but the canonical form shown to users remains the originally selected casing. The entity's **display name** — a separate, mixed-case, Unicode-tolerant field on `Profiles`/`OpenMics` — is where `Paul Dermody`, `PAUL 🎤`, or any other presentation form lives; the handle is the identifier and is case-insensitive for resolution but preserves user-chosen casing for canonical presentation.

---

## 6) Auto-Generation on Create

Every profile and every open-mic gets a handle **at creation time** — no opt-out, no UUID-only entities floating around. This is the flagship shareability feature and every entity gets to benefit from it from day one.

**Algorithm:**

1. Take the entity's display name (`Profile.display_name` or `OpenMic.name`).
2. Normalize: NFKD, strip combining marks (é → e), lowercase, replace `&` with `-and-`, replace any non-`[a-z0-9]` run with a single `-`, strip leading/trailing `-`, collapse `--` to `-`.
3. Truncate to 50 chars, then trim to the last `-` boundary if truncation cut mid-word.
4. If the result is `<3` chars, empty, all-digits, UUID-shaped, or reserved → append a short random suffix (`-x7k2`) instead.
5. If the candidate collides with an existing `Handles.handle` (any status) → try `-2`, `-3`, … up to `-9`; then fall back to `-<random-4-char>`.
6. Reject and force the user to pick manually if 10 attempts fail (essentially never happens).

**User override at create.** The create form shows the auto-generated handle as an editable field with live availability check (debounced `GET /api/handles/check/:candidate`). The user can accept the suggestion or type their own. Both go through the same validation.

**Examples:**

| Display name | Auto-generated handle |
|---|---|
| Portlaoise Spotlight Sessions | `portlaoise-spotlight-sessions` |
| Paul Dermody | `paul-dermody` |
| Nighttown, Galway | `nighttown-galway` |
| Sarah's Open Mic! | `sarahs-open-mic` |
| Café del Mar | `cafe-del-mar` |
| The Open Mic @ McGrath's | `the-open-mic-at-mcgraths` |

---

## 7) Rename Policy & Redirect / Quarantine Flow

We intentionally do not keep a full permanent handle history. Handles are treated as public aliases, not as a permanent identity lineage. This keeps the model simpler, easier to explain, and safer from abuse.

Users can change the casing of their handle at any time. A case-only change updates the existing current handle row in place, does not create redirect or quarantine history, and does not consume or reset the semantic rename limit. A change to any character other than letter case is a semantic rename and is subject to the following rules:

1. **Redirect window: 30 days.** When a profile or open-mic is renamed, the old handle becomes a redirect handle for 30 days. During that period:
   - the old handle forwards to the new handle
   - the old handle is hidden from search and discovery
  - repeated semantic renames are blocked until the redirect period ends
   - the system does not expose the old handle in public directories or recommendation surfaces

2. **Quarantine window: 30 days.** After the 30-day redirect period expires, the old handle enters a 30-day quarantine period. During quarantine:
   - the handle is still not reusable
   - it remains hidden from search and public discovery
   - it is kept as an inactive alias to prevent churn and impersonation

3. **Auto-reclaim.** After the combined 60-day cycle ends, the handle becomes automatically available again. A scheduled job marks it as `available` and it can be reused by a new profile or open-mic.

4. **No permanent history chain.** We do not keep a long-term chain of old handles or a permanent redirect lineage. A user may change the handle, but the platform does not preserve an unlimited history trail for that name. This reduces operational complexity while still protecting existing links and public references.

5. **Rename cooldown.** A user cannot perform another semantic rename on the same profile while the old handle is still in redirect status or quarantine status. Case-only changes remain available during this period.

6. **Case-only changes.** The owner may change only the letter casing of the current handle as often as desired. The system keeps the same case-insensitive handle identity, updates the stored canonical casing in place, and does not create a redirect row. Requests using the previous casing resolve to the same current row and receive a 301 to the newly stored canonical casing. The UI must label this as a **case-only change** and clearly state that changing any other character starts the normal rename flow with its rate limit, redirect window, quarantine window, and any applicable cooldown.

**Requests to a redirect handle serve a 301** to the current handle for the 30-day redirect period. Case is ignored during the resolver path, so `@Paul-Dermody`, `@paul-dermody`, and `@PAUL-DERMODY` all resolve to the same entity. Any case variant that differs from the stored canonical handle casing is also redirected with a 301 to the exact canonical URL. After the redirect period ends, the handle is not publicly discoverable and is not reusable until the quarantine period completes.

**No follower notification on rename (v1).** Renames do not fan out a notification to followers. The redirect keeps older links working and the user sees the change in their own dashboard or profile settings when they next inspect it.

---

## 8) Reclamation, Tombstoning, Locked Profiles, and Hidden / Blacklisted Profiles

### 8.1 Reclamation and tombstoning

Handles are not permanently reserved after deletion. After a profile or open-mic is hard-deleted, the handle goes through the same temporary window model as a rename:

- **Redirect period:** 30 days, if desired for continuity of old links
- **Quarantine period:** 30 days
- **Auto-reclaim:** handle becomes available automatically after the combined 60-day window

This prevents immediate re-use while keeping the model simple and compatible with user-driven handle changes.

| Event | Handle status transition |
|---|---|
| Soft-deleted entity | Handle remains attached and the entity stays hidden; the resolver returns HTTP 404 until restore. |
| Restored entity | Handle resumes normal use and returns to `current`. |
| Hard-deleted entity | Handle moves to `quarantined` or `tombstoned` depending on whether a short redirect is desired, then becomes `available` after auto-reclaim. |
| Handle renamed | Old handle moves to `redirect` for 30 days, then `quarantined` for 30 days, then `available`. |

**Tombstoned handles** remain possible as a defensive state when a handle must never be reused, such as severe impersonation or a legal hold. In those cases, the row is kept as `tombstoned` and the handle is never auto-reclaimed. The system continues to keep the row for audit and safety reasons without exposing it to search or public discovery.

### 8.2 Locked profiles

Some profiles may be marked as **locked** to prevent deletion for audit, legal, moderation, or compliance reasons.

A locked profile:
- cannot be deleted by normal user actions
- cannot be hard-deleted until the lock is removed by an authorized admin
- may still remain in event registrations, historical records, and admin views
- may be hidden or blacklisted independently if needed

Suggested fields:
- `locked` (boolean)
- `locked_by` (admin account id, optional)
- `locked_at` (timestamp)
- `locked_reason` (optional admin note)

This is especially useful when we need to preserve user history for audit or moderation review while still preventing accidental deletion.

### 8.3 Hidden and blacklisted profiles

Some profiles should never appear in public search or public comments even though they remain tied to historical registrations.

#### Hidden profile
- removed from search results
- removed from public listing pages
- excluded from profile suggestions
- excluded from public comment author discovery
- may remain visible in event registration history and admin views

#### Blacklisted profile
- treated as stronger privacy or trust restriction
- removed from all public discovery and search surfaces
- not shown in comments or profile-linked discovery
- not visible in public profile browsing
- may remain in registration records and moderation records

A profile can be both hidden and locked or hidden and blacklisted depending on the situation. The visibility state is independent of registration history.

### 8.4 Deleted or blacklisted account content

Content such as comments, photos, and profile media from a deleted or blacklisted profile remains in the database for history and moderation integrity, but the public presentation should be anonymized.

The source is displayed as:
- `Deleted account`
- or `Account removed`

This means:
- the content remains available in its original event context
- the profile is not clickable or searchable
- the profile does not appear in follow, suggestion, or comment author surfaces
- the content is retained without exposing or re-activating the profile

### 8.5 Search and discovery exclusion

Redirected handles, quarantined handles, hidden profiles, and blacklisted profiles must not appear in public search or index surfaces.

The visibility rule is simple:
- `current` + public profile => searchable
- `redirect` => not searchable
- `quarantined` => not searchable
- `hidden` / `blacklisted` => not searchable
- `deleted` => not searchable

This ensures the public catalog stays clean while registrations and historical records remain intact.

---

## 9) Reserved Handles

Reserved handles live in the **`Handles` table** as rows with `status='reserved'`, not in a code constant. The unique index on `handle` is the sole enforcement point — an attempt to insert a `current` row with a handle already reserved fails with the same conflict as any other collision, and the resolver treats reserved handles the same way it treats any non-`current` row (see [§10](#10-api-surface)).

**Why the DB, not code:**

- **Ops can add a reservation without a deploy** — critical when a new top-level route is being planned and marketing has already announced it.
- **One enforcement point** — the PK check that already blocks "handle is taken" now also blocks "handle is reserved". No `WHERE lower(handle) NOT IN (:reserved_list)` clause; no possibility of the check drifting between service instances during a rolling deploy.
- **Auditable** — `created_at`, `created_by_admin_id`, `reserved_category`, and `reserved_reason` give a clear paper trail for why any given handle is off-limits.
- **Retroactively safe** — attempting to reserve a handle currently held by a live entity fails with a specific error listing the holder, forcing an explicit remediation decision rather than silently allowing the collision.

**Initial seed.** A migration inserts the curated list below with the appropriate `reserved_category` on each row. The list is applied once at bootstrap and thereafter maintained via the admin API — the codebase does **not** hold a canonical `RESERVED_HANDLES` constant. A CI check parses the list of top-level routes registered in the router and asserts each one exists as a `status='reserved'` row in the seed migration; adding a new top-level route without seeding its reservation fails CI.

**Categories** (`reserved_category` values):

- **`route`** — Current top-level routes: `login`, `register`, `dashboard`, `open-mics`, `profiles`, `events`, `media`, `suggestions`, `notifications`, `messages`, `settings`, `accounts`, `admin`, `auth`, `api`
- **`infra`** — Infra / bot conventions: `www`, `static`, `assets`, `cdn`, `robots`, `sitemap`, `favicon`, `well-known`
- **`future`** — Anticipated future paths: `search`, `explore`, `discover`, `about`, `pricing`, `terms`, `privacy`, `help`, `blog`, `press`, `jobs`, `status`, `dmca`, `legal`
- **`impersonation`** — Impersonation risk: `admin`, `administrator`, `support`, `help`, `staff`, `moderator`, `mod`, `official`, `openmics`, `openmic`, `open-mic`, `system`, `root`, `null`, `undefined`, `venue`, `series`, `event`, `organizer`, `organiser`, `performer`, `artist`

All 1- and 2-character handles are blocked at validation time ([§5](#5-handle-validation-rules)), so single-letter and two-letter reservations are omitted from the seed — the validator, not the reserved-handles table, is the source of truth for that space.

**Adding a reservation later.** A platform admin calls `POST /admin/reserved-handles` with `{ handle, category, reason }`. The server inserts a `status='reserved'` row. If a `current`, `redirect`, `quarantined`, or `tombstoned` row for that handle already exists, the endpoint returns `409` with `code: HANDLE_ALREADY_HELD` and the holder's `entity_type` plus the holder's id (`profile_id` or `open_mic_id`, whichever is set) so the admin can decide whether to contact the holder, force a rename, or drop the reservation attempt. No background scanner is needed — the constraint is enforced synchronously.

**Releasing a reservation.** `DELETE /admin/reserved-handles/:handle` removes the row (only permitted for rows with `status='reserved'`; a real audit log entry is written). After deletion the handle is available for normal registration.

---

## 10) API Surface

### Resolver (public, unauthenticated)

```
GET /@:handle
```

- Returns the full entity payload plus discriminator:

  ```json
  {
    "type": "profile" | "open_mic",
    "canonical_handle": "Paul-Dermody",
    "requested_handle": "paul-dermody",
    "status": "current",
    "entity": { ... same shape as GET /profiles/:id or GET /open-mics/:id ... }
  }
  ```

- Visibility is evaluated before the entity payload is returned:
  - `public`: HTTP 200 for unauthenticated callers.
  - `unlisted`: HTTP 200 for callers with the direct handle URL, but excluded from directories and sitemaps.
  - `private`: HTTP 404 for unauthenticated callers. Owner and collaborator access uses an authenticated, non-cacheable entity endpoint rather than this public resolver.
  - soft-deleted or otherwise unavailable entities: HTTP 404. A hard-deleted entity whose handle is `tombstoned` returns HTTP 410 as specified below.
- The resolver never returns private fields or a personalized response. It is safe to cache only the public representation at the edge; viewer cookies and authorization headers are ignored for this route.
- If `requested_handle !== canonical_handle` (a retired handle or a case variant): HTTP 301 with `Location: /@<canonical_handle>`.
- If handle is `tombstoned`: HTTP 410 Gone.
- If handle is `reserved`: HTTP 404 (the reserved status is intentionally not disclosed by the public resolver — the availability-check endpoint is the only surface that reveals it).
- If handle doesn't exist: HTTP 404.
- Cached aggressively at the edge (long TTL); invalidated on rename, soft-delete, or entity update.

Design note: returning the entity payload inline saves a round trip on the happy path. Clients that need only the type + id (e.g. deep-link routing) can pass `?resolve=id` to get a minimal `{ type, entity_id, canonical_handle }` response.

### Availability check (used by create/rename forms)

```
GET /api/handles/check/:candidate
```

Returns `{ available: true }` or `{ available: false, reason: "reserved" | "in_use" | "invalid_format" | "redirect" | "quarantined" | "tombstoned" }`. Rate-limited per session to prevent enumeration of redirect/quarantine/tombstoned handles as a signal for impersonation targets.

### Handle mutations

Handles are mutated **through the parent entity**, not via a separate handles endpoint:

- On profile create (`POST /profiles`): body includes `handle`. Auto-suggested by the frontend; user can override.
- On profile handle update (`PATCH /profiles/:id`, field: `handle`): a case-only change is allowed without the semantic rename rate limit; changing any other character uses the normal rename flow, rate limit, and validation. Returns `409` with `code: HANDLE_RATE_LIMITED` or `code: HANDLE_UNAVAILABLE` on conflict.
- Same shape for `POST /open-mics` and `PATCH /open-mics/:id`.

The handle-writing logic is a shared server-side helper called by both entity mutation paths. Never expose a raw `PUT /handles/:handle` endpoint — it complicates permission checks and encourages orphan handles.

### Reserved handles (platform-admin only)

Reserved handles are managed directly because they have no parent entity to hang off ([§9](#9-reserved-handles)):

```
GET    /admin/reserved-handles                    (list; supports ?category= filter and pagination)
POST   /admin/reserved-handles                    (body: { handle, category, reason }; inserts a status='reserved' row)
DELETE /admin/reserved-handles/:handle            (only removes rows where status='reserved'; writes an audit log entry)
```

- All three require `is_platform_admin=true`.
- `POST` returns `409` with `code: HANDLE_ALREADY_HELD` if the handle already exists as `current` or `retired`, and includes the holder's `entity_type` and the holder's id (`profile_id` or `open_mic_id`) in the error payload so the admin knows what they're up against.
- `POST` returns `409` with `code: HANDLE_ALREADY_RESERVED` if the row already exists with `status='reserved'` (idempotent create is not automatic; the admin must delete first if they want to change category/reason).
- `DELETE` returns `409` with `code: HANDLE_NOT_RESERVED` if invoked on a `current`, `retired`, or `tombstoned` row — protecting live handles from being accidentally released via the reservation API.

### Existing UUID endpoints stay

`GET /api/profiles/:id` and `GET /api/open-mics/:id` continue to work for internal/machine callers. They also return the `canonical_handle` field so callers can build the public URL.

---

## 11) Frontend Routing (TanStack Router)

The catch-all `/@` route is the only new top-level route. Everything else in the [Key Pages](4-open-mic-technical-architecture.md#6-frontend-architecture) list continues to use its existing form; the UUID versions serve as internal navigation and 301 to the handle version on direct hits.

```ts
// Existing type-scoped routes stay — they still work by UUID, and their loaders 301 to the handle URL:
createFileRoute('/profiles/$id')(...)              // /profiles/<uuid> → 301 /@<handle>
createFileRoute('/open-mics/$id')(...)             // /open-mics/<uuid> → 301 /@<handle>
createFileRoute('/open-mics/$id/events/$eid')(...) // event under a series (works for UUID or handle)

// New: the vanity catch-all
createFileRoute('/@$handle')({
  loader: async ({ params }) => resolveHandle(params.handle),  // HTML GET /@:handle; API calls use the /api root
  component: HandleRouter,
})

// New: nested event route under a handle
createFileRoute('/@$handle/events/$eventId')({
  loader: async ({ params }) => {
    const resolved = await resolveHandle(params.handle);
    if (resolved.type !== 'open_mic') throw notFound();
    return loadEvent(resolved.entity.id, params.eventId);
  },
  component: EventDetail,
})
```

`HandleRouter` switches on the resolved `type` and renders either `ProfileDetail` or `OpenMicDetail`. Both components are already lazy-imported by their UUID routes; the vanity route reuses those chunks — **no extra bundle cost**.

**Router precedence.** TanStack Router matches specific routes before catch-alls, so `/login`, `/dashboard`, `/settings`, etc. all match their explicit routes and never reach `/@$handle`. The `@` prefix means the vanity route can't collide with any current or future top-level path that doesn't start with `@` — that's the whole point.

**Prefetch on hover.** `<Link to="/@$handle" params={{ handle }} preload="intent">` prefetches the resolver call and the resolved chunk on hover, so most vanity navigations are already warm before click.

---

## 12) Canonicalization, Redirects & SEO

**One canonical URL per resource.** The handle URL is canonical for public consumption. UUID URLs are internal-and-legacy.

Every response emits:

```html
<link rel="canonical" href="https://openmics.org/@paul-dermody">
```

Even the UUID URL response, before its 301, sets `rel=canonical` to the handle URL (defensive — some crawlers cache the pre-redirect HTML).

**301 vs 302.** Handle-to-handle redirects (redirect → current) are **301 Permanent** during the 30-day redirect window. UUID-to-handle redirects are also **301** — the UUID form is stable, and telling crawlers the handle is the canonical form is the whole point.

**Sitemap.** `sitemap.xml` lists only handle URLs, never UUID URLs. Generated nightly from `Profiles`/`OpenMics` where `status='published'` (or equivalent) and `deleted_at IS NULL`.

**Trailing slashes and case.** Both are normalized with 301 to the canonical form: no trailing slash and the exact stored handle casing. For example, a request for `openmics.org/@paul-dermody` redirects to `openmics.org/@Paul-Dermody` when `Paul-Dermody` is the stored canonical handle.

---

## 13) Social Sharing / OpenGraph

People will share vanity URLs through WhatsApp, iMessage, Facebook, Instagram, Slack, LinkedIn, and other services that require metadata in the initial HTML response. A generic static SPA document would make every preview identical.

**Approach: Fastify-rendered public documents.** CloudFront routes `/@:handle` and `/@:handle/events/:eventId` requests to Fastify; all static assets and other SPA routes remain on the S3 origin. Fastify resolves the public entity or event, applies the same visibility and soft-delete policy as the JSON resolver, and returns a small HTML document containing:

- escaped `<title>` and description metadata;
- canonical, OpenGraph, and Twitter card tags;
- the Vite SPA entry script and root element.

The same response is served to browsers and crawlers. Crawlers consume the metadata without JavaScript; browsers load the SPA and continue with the normal client-side route. This avoids user-agent detection, Lambda@Edge, and a separate public `/og/:handle` endpoint.

**Shared document shell.** The Vite `index.html` template is the sole definition of the SPA document shell. Its build output, with explicit metadata placeholders, is packaged with Fastify. For handle requests Fastify replaces only the placeholders with escaped public metadata; it does not maintain a separate HTML template. This guarantees that public-document responses and ordinary SPA responses differ only in their page metadata.

**Caching and safety.** CloudFront caches each normalized public path independently. Fastify returns `404` for private, unavailable, or deleted entities and emits only sanitized public fields in metadata. The public document must use correctly escaped HTML, `Cache-Control` appropriate to the metadata freshness target, and never forward viewer cookies or authorization headers to this cacheable route. Purge or revalidate the corresponding path after public metadata changes. CloudFront's cache-key policy for these routes explicitly excludes attribution query params (`ref`, `utm_*`) — the server response never varies based on them, so including them in the cache key would fragment the cache per shared link and let a malicious or accidental unique `ref` value bypass caching entirely. The referral value is read client-side from the URL after the cached HTML loads.

**This ships with vanity URLs.** Per-URL previews are part of the shareability contract.

---

## 14) Impersonation, Abuse & Moderation

Because handles are permanent public identity, they're a moderation surface.

**Preventative controls:**

- Reserved-word list ([§9](#9-reserved-handles)) blocks the obvious impersonation vectors.
- Rate limit on semantic handle changes (once per 30 days) blocks rename-as-attack; case-only changes are exempt.
- Availability check endpoint is rate-limited per session to prevent handle enumeration.

**Reactive controls needed at platform-admin level:**

- - **Force-rename**: platform admin can rename an entity's handle (e.g. impersonation, trademark complaint, DMCA takedown). The admin must choose the outcome for the old handle at the time of the rename: `redirect`, `quarantine`, `tombstoned`, or `available` if the action is a deliberate release. The system does not force a tombstone outcome by default.
- **Force-tombstone**: platform admin can retire a handle without deleting the entity (e.g. for a resolved impersonation dispute). The handle becomes non-resolvable and is not auto-reclaimed; this is one explicit option among several, not the default.
- **Handle-history audit log**: every rename/force-rename/tombstone is recorded in `Handles.created_by_profile_id` + a separate `HandleAuditLog` table (out of scope for this doc; TBD when the moderation console is designed).

None of these need to ship for MVP as long as (a) reserved-word list is comprehensive on day one and (b) there's a manual DB-level escape hatch for platform admins.

---

## 15) Migration Considerations

At the point vanity URLs ship, all existing profiles and open-mics need handles. Since we're auto-generating handles at create, a one-time migration runs the same auto-generation algorithm over the historical rows:

1. Iterate `Profiles` and `OpenMics` in creation order (oldest first — first come, first served for name conflicts).
2. For each, run the auto-generator against the current display name.
3. Insert into `Handles` and set `current_handle` on the entity.
4. On conflict, apply `-2`/`-3` suffix as usual.
5. Report a diff: rows where the auto-generated handle differs meaningfully from the display name (heavy suffixing, truncation) so a human can review and hand-adjust before the migration is public.

Users can rename immediately after migration if they don't like their auto-assigned handle. The 30-day rate limit doesn't apply to the very first rename after migration — one free rename per entity as a courtesy.

Realistically at MVP the migration is trivial (fewer than 1000 entities). This section is for the retrospective — future readers looking at when we started using handles will find this the useful record.

---

## 16) What we're not building yet

- **Handles for events, media, suggestions, or messages.** Series-handle + event id is enough.
- **International / non-ASCII handles.** Deferred until we have a real user request from a market that needs it, and a plan for confusable defense.
- **Reserved-handle marketplace / auction.** No.
- **Verification badges (blue-check style).** Not for MVP; revisit when impersonation reports show up.
- **Custom domain per organizer** (e.g. `portlaoise-spotlight-sessions.com` CNAME'd to us). Post-MVP, low priority.
- **Prerender.io / SSG.** Fastify-rendered public documents provide the required metadata for now.

---

## 17) Open Questions

*None outstanding.*
