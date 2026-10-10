# Data Model

**Related:** [../4-open-mic-technical-architecture.md](../4-open-mic-technical-architecture.md)

This document is split into two parts:

1. **[Phase 1 schema (current)](#phase-1-schema-current)** — the tables and behavior that Phase 1 depends on. Should track what is implemented in [`apps/api/migrations/`](../../apps/api/migrations) and what is contracted in [`openapi.yaml`](../../openapi.yaml). Deviations are drift — flag them, do not silently follow one side.
2. **[Post-MVP appendix](#post-mvp-appendix)** — schemas and prose describing features that are explicitly deferred (multi-admin roles, comments/reviews, reactions, private messaging, notifications, plans/quotas, account deletion pipeline). Kept as design reference; do not treat as an implementation target.

Cross-cutting decisions live in [decisions.md](../decisions.md). When this document and `decisions.md` disagree, `decisions.md` wins.

---

## Phase 1 schema (current)

### City catalogue boundary

The location-discovery slice keeps a UUID-backed `cities` table with stable source identity, Unicode/ASCII city and country names, ISO2/ISO3, administrative region, centre coordinates/geography, nullable population and retirement state. The packaged versioned JSON catalogue is the city-search authority; API startup validates the JSON but neither reads nor compares the full database catalogue. Explicit import synchronizes JSON into PostgreSQL by source identity, preserving UUIDs and refusing removal of managed source identities. Search resolves candidate UUIDs by source identity; missing mappings produce an explicit import-required error.

Nullable `city_id` on accounts, series and events, and `performer_city_id` on registrations supplement existing text snapshots. Resolved selection supplies canonical city/country, while free-text edits unlink stale references. Partial updates distinguish omitted fields from explicit clearing. Ambiguous legacy records remain unresolved; account ownership/adoption and catalogue refresh never rewrite guest provenance. Exact venue coordinates are separate from city centres.

The cities table remains authoritative for saved-city reads, selection validation and PostGIS calculations, so temporary JSON/database differences are permitted until an explicit import. Retired rows remain readable and eligible for public discovery when they have public series, but are excluded from autocomplete and cannot be newly selected for detail edits. No city-provider cache is stored. Dataset packaging and attribution must preserve the applicable source licence. See [decisions.md](../decisions.md#city-catalogue-and-public-discovery).

```sql
Accounts
├── id (UUID)
├── cognito_id
├── email
├── display_name
├── city (optional)
├── city_id (FK to cities, nullable — resolved browsing origin, separate from city text)
├── preferred_language (text, nullable — BCP 47 tag e.g. 'en', 'ga', 'fr'; drives the frontend's i18n locale resolution when set; NULL means "honour the browser")
├── current_profile_id (FK to Profiles, nullable — indicates which profile user is currently using)
├── is_platform_admin (boolean — platform super user, manages entire platform)
├── created_at, updated_at
# UNIQUE (email); UNIQUE (cognito_id);
# `plan`, `referred_by_profile_id`, and `referred_at` columns are described in the post-MVP appendix and are not part of the Phase 1 schema.

Profiles (unified performer & organizer identities)
├── id (UUID)
├── created_by_account_id (FK — account that created this profile)
├── slug (text — LEGACY; retained for backward-compat, superseded by handles per decisions.md → API Contract)
├── profile_name (e.g., "Solo", "Jazz Band", or open mic series name)
├── profile_kind ("organizer" | "performer" — organizer profiles own open-mic series; performer profiles are the identities selected on registrations; immutable after creation; only performer profiles hold handles, so `current_handle` is always NULL for organizers)
├── bio
├── profile_image_url (S3 URL or NULL)
├── theme_name (named theme for UI customization; themes defined separately)
├── color_mode ("light" | "dark", nullable) — accompanies theme_name; both are per-profile preferences captured during profile creation and editable afterward via `PATCH /profiles/{id}`
├── visibility ("public" | "unlisted" | "private") — default "public"
├── show_gig_media (boolean, default true — profile-owner display toggle for the derived gig-media gallery on the public profile page; event and series galleries are unaffected, and it is not a substitute for registration media_consent)
├── created_at, updated_at
├── deleted_at, deleted_by_profile_id (FK, nullable), recovery_deadline
# UNIQUE (slug); CHECK (visibility IN ('public','unlisted','private'))
# CHECK (profile_kind IN ('organizer','performer'));
# CHECK (color_mode IN ('light','dark'));

ProfileLinks (contact and social links for a profile)
├── id (UUID)
├── profile_id (FK — Profiles entry)
├── type ("website" | "instagram" | "youtube" | "tiktok" | "twitter" | "facebook" | "spotify" | "bandcamp" | "email" | "phone" | "other")
├── url (or contact string for email/phone)
├── label (nullable — optional display label override)
├── sequence (integer — display order)
├── created_at, updated_at
# CHECK (type IN ('website','instagram','youtube','tiktok','twitter','facebook','spotify','bandcamp','email','phone','other'));
# INDEX (profile_id, sequence)

OpenMics
├── id (UUID)
├── owner_profile_id (FK → Profiles.id)
├── current_handle (FK → Handles.handle, unique)
├── slug (text — LEGACY; retained for backward-compat, superseded by handles per decisions.md → API Contract)
├── name
├── description (nullable)
├── public_information (text, nullable — public visitor instructions; existing rows remain empty)
├── activities text[]
├── venue_name (NOT NULL)
├── address_line1 (NOT NULL), address_line2 (nullable)
├── postcode (nullable), city (NOT NULL), country (NOT NULL)
├── city_id (FK to cities, nullable — does not replace exact venue coordinates)
├── lat numeric(9,6), lng numeric(9,6) (nullable)
├── time_zone (text — IANA time zone such as `Europe/Dublin`)
├── website (text, nullable)
├── contact_email (text, nullable)
├── schedule_summary (text, nullable — short public fallback such as "Every 2nd Tuesday, 8pm")
├── schedule_details (text, nullable — longer public schedule explanation)
├── originals_only (boolean, default false)
├── amplification_available (boolean, default false)
├── age_policy ("adults_only" | "children_only" | "both")
├── registration_mode ("pre_only" | "on_night_only" | "both" | "external")
├── external_registration_url (text, nullable — required when registration_mode='external'; where visitors go to register when there's no on-platform registration for this open mic)
├── entry_fee_amount (numeric(10,2), NOT NULL, default 0.00 — 0 means free entry, which is the common case for open mics)
├── entry_fee_currency (text, nullable — ISO 4217 3-letter code e.g. 'EUR', 'GBP', 'USD'; required when entry_fee_amount > 0, otherwise ignored)
├── entry_fee_note (text, nullable — free-text override; when set, the UI displays this verbatim instead of formatting the amount, covering cases like "Pay what you can", "€5–€10 sliding scale", or "Free but please buy a drink")
├── location (geography(Point, 4326) GENERATED ALWAYS AS (
│              CASE WHEN lat IS NOT NULL AND lng IS NOT NULL
│                   THEN ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography
│              END) STORED — spatial column for map + near-me queries)
├── tags text[]
├── status ("active" | "paused" | "ended" | "draft") — default "draft"
├── created_at, updated_at
├── deleted_at, deleted_by_profile_id (FK, nullable), recovery_deadline
# CHECK (activities <@ ARRAY['singing','poetry','jam','trad','comedy','storytelling','other']);
# CHECK (array_length(activities, 1) >= 1); INDEX GIN (activities); INDEX GIN (tags)
# CHECK (age_policy IN ('adults_only','children_only','both'));
# CHECK (registration_mode IN ('pre_only','on_night_only','both','external'));
# CHECK (registration_mode <> 'external' OR external_registration_url IS NOT NULL);
# CHECK (entry_fee_amount = 0 OR entry_fee_currency IS NOT NULL);
# CHECK (entry_fee_amount >= 0);
# CHECK (status IN ('active','paused','ended','draft'));
# INDEX GIST (location);   -- fast bounding-box + ST_DWithin queries
# UNIQUE (slug)
# `rating_avg`/`rating_count` columns are described in the post-MVP appendix (reviews are deferred).

Events
├── id (UUID)
├── open_mic_id (FK)
├── slug (text — LEGACY; retained for backward-compat with legacy URLs, superseded by handles + event id per decisions.md → API Contract)
├── title
├── starts_at (timestamptz — date and local start time converted using `time_zone`)
├── ends_at (timestamptz, nullable — local end time converted using `time_zone`)
├── time_zone (text — IANA time zone such as `Europe/Dublin`, used for local editing/display and cutoff calculations)
├── status ("draft" | "published") — event publication lifecycle; combined with the derived `future`/`running`/`past` phase from timestamps to gate public visibility, per decisions.md → Milestone 2 event lifecycle
├── registrations_closed_at (timestamptz, nullable — no new registrations after this time)
├── venue_name (NOT NULL — defaults from OpenMics when the event is created)
├── address_line1 (NOT NULL), address_line2 (nullable)
├── postcode (nullable), city (NOT NULL), country (NOT NULL)
├── city_id (FK to cities, nullable — part of the inherited/overridden venue snapshot)
├── lat numeric(9,6), lng numeric(9,6) (nullable — defaults from OpenMics when the event is created)
├── location (geography(Point, 4326) GENERATED ALWAYS AS (
│              CASE WHEN lat IS NOT NULL AND lng IS NOT NULL
│                   THEN ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography
│              END) STORED — map location generated from the event's copied coordinates)
├── activities text[]  (nullable — NULL inherits from OpenMics.activities;
│                       when set, replaces the OpenMic's allowed set for this event)
├── tags text[]
├── capacity (integer, nullable — soft suggested attendance limit, not an admission block; configuration remains plan-capped)
├── audience_guest_count (integer, nullable, non-negative — organizer-maintained audience excluding performers; legacy NULL means unknown, new events explicitly start at zero)
├── public_information (text, nullable — creation-time snapshot from series or source event, explicitly clearable; never populated from private notes)
├── entry_fee_amount (numeric(10,2), nullable — per-event override; NULL inherits from OpenMics.entry_fee_amount)
├── entry_fee_currency (text, nullable — per-event override; NULL inherits from OpenMics.entry_fee_currency)
├── entry_fee_note (text, nullable — per-event override; NULL inherits from OpenMics.entry_fee_note)
├── notes (text, nullable — organizer-only private notes)
├── created_at, updated_at
├── deleted_at, deleted_by_profile_id (FK, nullable), recovery_deadline
# CHECK (activities IS NULL OR activities <@ ARRAY['singing','poetry','jam','trad','comedy','storytelling','other']);
# CHECK ((lat IS NULL) = (lng IS NULL));
# INDEX GIN (activities); INDEX GIN (tags)
# INDEX GIST (location);
# UNIQUE (open_mic_id, slug)
# The prior `running` (boolean, nullable) column is retired: event phase is derived from `starts_at`/`ends_at`, not stored. See decisions.md → Milestone 2 event lifecycle.
# `rating_avg`/`rating_count` columns are described in the post-MVP appendix (reviews are deferred).
```

**Event location snapshot.** The create-event page pre-fills `venue_name`, `address_line1`, `address_line2`, `postcode`, `city`, `country`, `lat`, and `lng` from the selected `OpenMics` row. `POST /events` requires `open_mic_id` and creates the event and its location snapshot in one database transaction. Location is overridden as one atomic input: the request must provide the complete address and geographic location together, including `venue_name`, `address_line1`, `address_line2`, `postcode`, `city`, `country`, `lat`, and `lng`, or provide none of them and inherit the complete parent snapshot. Partial address or coordinate overrides are rejected, and supplied coordinates must pass latitude/longitude bounds checks (`-90..90`/`-180..180`) and be present together or not at all. Coordinates are not re-validated against the address text server-side; the frontend's map/geocoding-assisted location picker (see [API design: Geocoding](api-design.md#geocoding)) is the mechanism that keeps the typed address and the submitted `lat`/`lng` consistent before submission. The generated `Events.location` then supplies the event map pin. An organizer may therefore create a one-off event at another venue, while later edits to the parent open mic never alter existing events.

```sql
Registrations
├── id (UUID)
├── event_id (FK)
├── profile_id (FK or NULL for guests, references Profiles for registered performers)
├── performer_name (guest name, required when profile_id is NULL)
├── performer_city (optional)
├── performer_city_id (FK to cities, nullable — preserves the submitted performer-city snapshot)
├── contact_email (nullable — required unless organizer_supervised; used for email confirmation, magic edit links, and user-initiated claim after sign-in)
├── contact_phone (nullable)
├── submission_channel ("organic" | "shared_link" | "email_reminder" | "social_ad" | "poster_qr" | "kiosk" | "kiosk_qr" | "prior" — descriptive attribution tag only; does not by itself gate visibility or claim eligibility)
├── organizer_supervised (boolean, default false — true only for registrations entered by an organizer/assistant at the event via the kiosk; the sole gate for immediate public visibility without email verification for non-QR channels)
├── referred_by_profile_id (FK to Profiles, nullable — captures which profile's shared link the registrant followed, via a `?ref=<profile_id>` query param on the registration link; invalid/missing values are silently ignored, never rejected)
├── media_consent (boolean)
├── media_consent_updated_at (timestamptz, nullable — audit record of when media_consent last changed; not a grandfathering boundary — consent revocation is retroactive, see [decisions.md → Guest Registrations](../decisions.md#guest-registrations))
├── edit_token_hash (text, nullable — SHA-256 hash of the opaque token emailed to guests for magic-link edits; never store the raw token; UNIQUE)
├── edit_token_expires_at (timestamptz, nullable — set to event end plus 30 days; cleared on rotation or expiry)
├── email_verification_token_hash (text, nullable — SHA-256 hash of the opaque one-shot token emailed to guests to confirm ownership of contact_email; never store the raw token; UNIQUE)
├── email_verification_token_expires_at (timestamptz, nullable — set to event start + 24h, or 72h after creation for events further out)
├── verification_method ("email" | "organizer_kiosk" | "kiosk_qr" | "authenticated_account", nullable — records how the registration became verified)
├── email_verified_at (timestamptz, nullable — set when the guest confirms contact_email; unless organizer_supervised or kiosk_qr, a guest row is "pending" and hidden from the public roster and from claim eligibility until this is set)
├── claimed_by_account_id (FK to Accounts, nullable — set only when a signed-in account explicitly claims this guest registration; never populated automatically on Cognito email verification)
├── claimed_at (timestamptz, nullable)
├── created_at, updated_at
├── deleted_at, deleted_by_profile_id (FK, nullable), recovery_deadline
# CHECK (submission_channel IN ('organic','shared_link','email_reminder','social_ad','poster_qr','kiosk','kiosk_qr','prior'));
# CHECK (organizer_supervised = FALSE OR submission_channel = 'kiosk');   -- organizer_supervised is only ever true for kiosk-originated rows
# CHECK (organizer_supervised OR profile_id IS NOT NULL OR contact_email IS NOT NULL);
# CHECK ((claimed_by_account_id IS NULL) = (claimed_at IS NULL));
# CHECK (claimed_by_account_id IS NULL OR profile_id IS NULL);  -- claiming never silently converts a guest row into a profile registration
# CHECK (verification_method IS NULL OR verification_method IN ('email','organizer_kiosk','kiosk_qr','authenticated_account'));
# UNIQUE (event_id, profile_id) WHERE deleted_at IS NULL AND profile_id IS NOT NULL
# UNIQUE (edit_token_hash) WHERE edit_token_hash IS NOT NULL
# UNIQUE (email_verification_token_hash) WHERE email_verification_token_hash IS NOT NULL
# INDEX (contact_email) WHERE contact_email IS NOT NULL AND claimed_by_account_id IS NULL
# "My registrations" for a signed-in account = rows where profile_id IN (my profiles) OR claimed_by_account_id = my account.
# "Publicly visible / valid" = rows where organizer_supervised OR verification_method='kiosk_qr' OR email_verified_at IS NOT NULL — applies uniformly across every non-kiosk channel (organic browsing, shared link, email reminder, social ad, poster QR); kiosk and kiosk-QR rows are visible immediately because the organizer's physical presence or the presence token substitutes for email proof.
# "Claimable by me" = rows where contact_email = my Cognito-verified email AND claimed_by_account_id IS NULL AND email_verified_at IS NOT NULL — verification is required for claim regardless of channel, including kiosk rows; an unverified kiosk registration is publicly visible but can never be claimed. A claim must adopt one of the account's performer profiles; account ownership and public performer attribution remain separate fields.

Performances
├── id (UUID)
├── registration_id (FK)
├── name
├── activity ("singing" | "poetry" | "jam" | "trad" | "comedy" | "storytelling" | "other")
├── sequence (integer — running order within the "present" or "scheduled" column only; see below)
├── status ("registered" | "present" | "scheduled" | "performing" | "performed" | "no_show" | "cancelled") — default "registered"
├── checked_in_at (timestamptz, nullable — set automatically when status first becomes "present")
├── scheduled_at (timestamptz, nullable — set automatically when status first becomes "scheduled")
├── started_at (timestamptz, nullable — set automatically when status first becomes "performing")
├── finished_at (timestamptz, nullable — set automatically when status first becomes "performed")
├── notes (text, nullable — organizer-only)
├── created_at, updated_at
├── deleted_at, deleted_by_profile_id (FK, nullable), recovery_deadline
# API enforces: Performances.activity must be in the effective activities set of the parent event
# (Events.activities if not NULL, else OpenMics.activities).
# CHECK (status IN ('registered','present','scheduled','performing','performed','no_show','cancelled'));
# Lifecycle: registered -> present (checked in at the door) -> scheduled (agreed to go next) ->
# performing (on stage) -> performed. no_show/cancelled are manual overrides from any state.
# Every one of these four forward transitions stamps its own timestamp column with the server's
# clock (never a client-supplied value); re-entering the same status refreshes that timestamp,
# with two exceptions: performed -> performing preserves started_at (it's the same set resuming,
# not a new one) and clears finished_at; performing -> scheduled (moved back a stage) clears both
# started_at and finished_at.
# sequence is scoped per status, not event-wide: "present" and "scheduled" are each their own
# independent bottom-filled queue (API assigns MAX(sequence)+1 within that column, or 1 if the
# column is empty, whenever a performance enters "present" or "scheduled" without an explicit
# sequence — e.g. a kiosk sign-up landing at the bottom of "present"). The organizer may reorder
# within "present" or "scheduled" by swapping two cards' sequence values; no other column supports
# manual reordering. "performing" holds at most one card, and "performed" order is implied entirely
# by finished_at (no sequence needed). "registered" cards are shown in registration order.
# API enforces two ordering restrictions beyond simple status transitions: only the "scheduled" card
# with the lowest sequence (top of the queue) may move to "performing"; only the "performed" card
# with the latest finished_at may move out of "performed" to any other status (covers moving a
# performer back in case they were advanced to "performed" by mistake).
# POST /events/:id/registrations creates the registration's first Performances row in the same
# transaction (status "present" for kiosk/organizer_supervised sign-ups, "registered" otherwise)
# so every registration always has at least one performance without a separate manual step. A
# performer doing a second set gets a brand-new Performances row (typically starting "present",
# since they are already known to be at the venue) rather than looping the first row backwards —
# and can only be started from an existing "performed" card (see "Perform again" action).
# Deleting a Performances row soft-deletes just that row, unless it's the registration's only
# remaining (non-deleted) performance — in that case the API also soft-deletes the parent
# Registrations row in the same request, since there would be nothing left to show and the
# performer would need to register again for a future set. This applies uniformly regardless of
# which status column the card is in, not just "registered". The organizer always confirms first,
# and the confirmation copy distinguishes "delete this performance" from "delete the registration".
# Event phase is derived from the event timestamps. Moving from running to past never changes
# performance rows automatically; organizers retain explicit control of roster statuses.
```

```sql
Media
├── id (UUID)
├── media_type ("photo" | "video")
├── event_id (FK, nullable — set when media is attached to an event; XOR with open_mic_id)
├── open_mic_id (FK, nullable — set for free-standing media uploaded directly to a series)
├── registration_id (FK to Registrations, nullable — performer attribution for event media; never set on series-scope media)
├── added_by_profile_id (FK — organizer profile that uploaded the media)
├── source_url (platform-bucket object URL for photos, canonical provider URL for videos)
├── mime_type (nullable), size_bytes (bigint, nullable)
├── width (nullable), height (nullable — intrinsic photo dimensions, filled in when the renditions pipeline reports back)
├── duration_seconds (nullable — videos)
├── thumbnail_url (nullable — provider-CDN poster frame for videos; photos leave it NULL)
├── video_platform (nullable — "youtube" | "vimeo"; set for videos only)
├── platform_video_id (nullable — canonical ID on that platform)
├── caption (nullable — may carry {performer_name}/{performer_city}/{event_name}/{event_date} tokens)
├── alt_text (nullable — server-derived from the substituted caption when omitted)
├── renditions (jsonb, nullable — named thumb/grid/lightbox/original variants with url/width/height/mime_type/size_bytes; NULL until the renditions pipeline reports back, always NULL for videos)
├── performer_name_snapshot, performer_city_snapshot (nullable — denormalized attribution captured at publish/attribution time so a soft-deleted registration leaves captions intact)
├── created_at, updated_at, deleted_at, deleted_by_profile_id (FK, nullable), recovery_deadline
├── deletion_reason (nullable — "organizer" | "consent_revocation")
# CHECK (media_type IN ('photo','video'));
# CHECK ((event_id IS NULL) <> (open_mic_id IS NULL));  -- exactly one owning scope
# CHECK (event_id IS NOT NULL OR registration_id IS NULL);  -- series-scope media is always free-standing
# CHECK (media_type='video' → video_platform IN ('youtube','vimeo') AND platform_video_id IS NOT NULL; photo rows carry no video fields);
# CHECK (deletion_reason IS NULL OR deletion_reason IN ('organizer','consent_revocation'));
# soft-delete field pairing: all four deletion columns NULL, or deleted_at + recovery_deadline + deletion_reason set (deleted_by_profile_id stays NULL for system-driven consent revocations)
# INDEX (event_id, created_at DESC, id) WHERE deleted_at IS NULL; INDEX (open_mic_id, created_at DESC, id); INDEX (registration_id); INDEX (deleted_at); INDEX (deletion_reason)

PendingS3Deletions (queue of S3 objects to delete; S3 is never deleted inline)
├── id (UUID)
├── bucket
├── object_key
├── media_id (FK to Media, nullable — original media row if still known; ON DELETE SET NULL)
├── reason ("purge" | "replace" | "abandoned_upload" | "manual")
├── scheduled_for (when the S3 delete worker may process this row)
├── attempts (integer, default 0)
├── last_error (nullable)
├── created_at
├── processed_at (NULL until the S3 object has been deleted)
# INDEX (scheduled_for) WHERE processed_at IS NULL; INDEX (bucket, object_key)

OpenMicFeaturedMedia (organizer-curated pins on a series page, manually ordered)
├── open_mic_id (FK — ON DELETE CASCADE)
├── media_id (FK — ON DELETE CASCADE)
├── position (integer — manual order within the series)
├── created_at
# PRIMARY KEY (open_mic_id, media_id); UNIQUE (open_mic_id, position)
# The API rejects pinning hidden/soft-deleted/consent-revoked media, and drops such pins on write paths (consent revocation removes them in the same transaction).
```

**Media source validation** (settled in [decisions.md → Media](../decisions.md#media)): photos must be objects in the platform's own S3 media bucket via the upload-url flow; videos must link to an allowlisted host (`youtube.com`, `youtu.be`, `vimeo.com`). Arbitrary hosts are rejected. Object keys are flat per media id: `tmp/{accountId}/{uuid}.{ext}` (presigned-PUT target, 24h lifecycle) → `original/{mediaId}.{ext}` → `renditions/{mediaId}/{thumb|grid|lightbox}.webp` (see [decisions.md → Media delivery](../decisions.md#media-delivery)).

**Media ownership, attribution, and consent.** `added_by_profile_id` is always the organizer profile that uploaded the media. Exactly one of `event_id` or `open_mic_id` supplies its owning scope. `registration_id` is optional and may be set only for a registration belonging to `event_id`; it attributes the media to that performer independently of individual performance/set rows. Performer profile galleries are derived through the registration's adopted profile and never own media directly. The organizer who owns the associated event or open-mic series may edit or delete the media.

Revoking a linked registration's media consent sets `deleted_at`, `recovery_deadline`, and `deletion_reason='consent_revocation'`. Restoring consent before the deadline automatically clears those fields only when the reason remains `consent_revocation`; organizer-deleted media is never restored by a consent change. After the deadline, the normal purge removes the bytes and consent restoration cannot recover them.

**Soft-delete / recycle bin model (Phase 1).**

- Every soft-deletable table (`Profiles`, `OpenMics`, `Events`, `Registrations`, `Performances`, `Media`) carries `deleted_at`, `deleted_by_profile_id`, and `recovery_deadline`.
- Reads filter on `deleted_at IS NULL`; restore = `UPDATE ... SET deleted_at = NULL, deleted_by_profile_id = NULL, recovery_deadline = NULL`.
- Recovery window is 30 days across every soft-deletable Phase 1 record, matching the handle redirect/quarantine cadence (see [decisions.md → Retention](../decisions.md#retention)).
- A unified `Deletions` journal table is described in the post-MVP appendix but has not been implemented. Phase 1 uses per-table columns without the shared journal; see [decisions.md → Milestone 2 event lifecycle](../decisions.md#milestone-2-event-lifecycle).
- Any `UNIQUE` constraint that should ignore deleted rows (e.g., unique registration per event+profile) is a partial unique index `WHERE deleted_at IS NULL`.

**MVP authorization scope.**

- Multi-admin collaboration is post-MVP. During Phase 1, the account in `Profiles.created_by_account_id` is the sole owner and the only account that can manage that profile's open mics, events, registrations, and settings.
- Phase 1 authorization checks the authenticated account against `created_by_account_id` for profile-scoped mutations; platform admins (`Accounts.is_platform_admin`) retain their platform-level bypass. `is_platform_admin` is always read from the `accounts` table and never trusted from a JWT claim, so a revoked admin loses access before Cognito's ID-token TTL would otherwise allow it.
- `Roles`, `Permissions`, `RolePermissions`, `AccountProfileRoles`, and `ProfileInvitations` are reserved for the post-MVP collaboration release. They are not required on Phase 1 request paths, and invitations, membership changes, team quotas, and role-management UI are excluded from Phase 1 delivery.

**Onboarding and profile-scoped preferences.**

- An account should never be left without at least one profile in practice. This is enforced client-side: after first sign-in, the frontend blocks all other routes behind a mandatory onboarding step (asking performer vs. organizer, plus theme/color_mode) until `POST /profiles` has created a first profile and `PUT /accounts/{id}/current-profile` has selected it. It is not a hard database constraint, since `profile_kind` is not known until the user answers the onboarding question.
- `theme_name` and `color_mode` are profile-level preferences, not account-level, because a single account may hold both a performer and an organizer profile that should look different. `AccountUpdateRequest` (`display_name`, `city`, `preferred_language`) intentionally excludes them.
- The same theme/color_mode selection UI is reusable whenever any new profile is created, not just during onboarding.

**Directory listing rules (`GET /open-mics`, and any future public map surface).**

- Every open mic must have an owning `profile_id` at creation — the caller's current profile becomes the owner. There is no unclaimed / third-party-listing state in Phase 1; ownership verification is deferred.
- The public directory excludes rows with `status IN ('draft','ended')` and `deleted_at IS NOT NULL`. `paused` rows are still returned with a visible "On break" indicator so the entry doesn't disappear from search when the organizer takes a temporary hiatus.
- Guest registration claiming applies only to event `Registrations` — there is no equivalent "claim an open mic" flow. Ownership transfer between profiles is a manual admin operation for now.

**Registration flows.**

All frontend entry points share the same `POST /events/:id/registrations` endpoint; `submission_channel` is a descriptive attribution tag only, and `organizer_supervised` plus `verification_method` are the fields that change verification/visibility behavior.

- **Self-serve (public).** Any visitor to `/events/:eventId/register`. If signed in, the caller must select an account-owned profile with `profile_kind='performer'`; the registration is immediately valid with `verification_method='authenticated_account'`. An organizer may register for their own event only after creating and selecting such a performer profile; the organizer profile itself cannot be used as the performer identity. If not signed in, the visitor supplies `performer_name` and a required `contact_email`; the row is created with `email_verified_at IS NULL` (pending) and is excluded from the public roster and from event roster caps until confirmed.
- **Email confirmation for self-serve guests.** On create, the API generates a one-shot `email_verification_token`, stores only its SHA-256 hash plus `email_verification_token_expires_at`, and enqueues an email with a link to `https://openmics.org/events/:eventId/register/verify?token=<verification_token>`. `POST /registrations/:id/verify-email` hashes the supplied token, compares it in constant time, sets `email_verified_at` and `verification_method='email'`, then clears the hash and expiry before triggering the standard post-registration flow (including the magic edit-link email). Pending rows past a TTL (event start + 24h, or 72h after creation for events further out) are hard-deleted by a background sweep so no unconfirmed row lingers as a claimable target.
- **Walk-in kiosk (organizer-supervised).** `organizer_supervised=true`, `submission_channel='kiosk'`. Requires event ownership on the caller's active profile. The registration is publicly visible immediately regardless of email state, because the organizer's physical presence substitutes for email proof. Set `verification_method='organizer_kiosk'` at creation. If `contact_email` is supplied, the API also sends a one-shot verification email using the hashed token flow; a later successful confirmation changes the method to `email`.
- **Kiosk QR (presence-token, phone).** A registration carrying a valid `kiosk_token` (see [decisions.md → Milestone 2 event lifecycle](../decisions.md#milestone-2-event-lifecycle)) is `submission_channel='kiosk_qr'`, `verification_method='kiosk_qr'`, immediately verified, and starts in the `present` performance state. It bypasses publication, phase, and `registrations_closed_at` checks and is exempt from capacity but still counts toward it. Duplicate-email rules still apply.
- **Magic-link editing.** On registration create (once publicly visible), if `contact_email` is set the API generates a random opaque `edit_token`, stores only its SHA-256 hash plus `edit_token_expires_at`, and enqueues an email containing a link like `https://openmics.org/events/:eventId/register?token=<edit_token>`. The resolve endpoint is rate-limited per IP and registration, never logs or echoes the raw token, returns `Cache-Control: no-store` and `Referrer-Policy: no-referrer`, and exchanges a valid URL token for a short-lived, HttpOnly, Secure, SameSite=Lax edit-session cookie. Tokens can be rotated via `POST /registrations/:id/rotate-edit-token`, which invalidates the previous hash immediately.
- **User-initiated guest → account claim.** `GET /me/claimable-registrations` lists guest registrations where `contact_email` matches the account's Cognito-verified email, `claimed_by_account_id IS NULL`, and `email_verified_at IS NOT NULL`. `POST /registrations/:id/claim` re-checks the email match against the caller's verified identity, then sets `claimed_by_account_id` and `claimed_at`. `profile_id` remains `NULL` — the registration stays guest-attributed on public listings but appears in the claiming account's "My registrations" list. Claim is never triggered by Cognito email verification alone; the user must confirm each row individually.
- **Referral attribution.** A shareable public page may carry `?ref=<profile_id>`. The client persists it and attaches it to the next conversion (registration or Cognito sign-up). Milestone 1 provisions accounts idempotently on first request without referral capture; the OAuth-state referral flow described in the post-MVP appendix is Milestone 3 work.

**Smart registration links and QR codes.**

- **Event-specific link/QR:** `/events/:eventId/register` always points at one fixed event.
- **Open-mic "next event" link/QR:** `GET /open-mics/:id/register` (and its vanity form `/@:handle/register`) resolves server-side via `GET /open-mics/:id/next-event` to the soonest upcoming, not-yet-closed event and forwards the visitor there. If no upcoming event exists, the page renders `schedule_summary`/`schedule_details` instead of a broken link or 404.
- Both link forms accept `?ref=<profile_id>` and carry it through the server-side redirect.
- The organizer console exposes one-tap **Copy link** and **Download QR code** actions for both link types.

---

## Post-MVP appendix

Everything below describes design work that is explicitly deferred by [decisions.md](../decisions.md) and [FEATURE-PLAN.md](../FEATURE-PLAN.md). None of it is expected in Phase 1. Contents are retained as design reference so a future phase can restore the earlier thinking without starting from scratch.

### Deferred Accounts columns

```sql
Accounts (post-MVP additions)
├── plan ("free" | "pro") — default "free"; drives quota limits (see Plans & quotas below)
├── referred_by_profile_id (FK to Profiles, nullable — referral supplied in a validated Cognito OAuth state value and stored when the application account is first provisioned; never overwritten afterward)
├── referred_at (timestamptz, nullable — set together with referred_by_profile_id during account provisioning)
# CHECK (plan IN ('free','pro'));
# CHECK ((referred_by_profile_id IS NULL) = (referred_at IS NULL));
```

### Follows and permission-based collaboration (post-MVP)

```sql
ProfileFollows (one profile "likes"/follows another)
├── id (UUID)
├── follower_profile_id (FK — Profiles entry doing the follow)
├── followee_profile_id (FK — Profiles entry being followed)
├── created_at
# UNIQUE (follower_profile_id, followee_profile_id);
# CHECK (follower_profile_id <> followee_profile_id);
# INDEX (follower_profile_id); INDEX (followee_profile_id)

Roles (permission groups)
├── id (UUID)
├── name (e.g., "Owner", "Admin", "Assistant", "Performer", "Organizer")
├── description
├── created_at, updated_at

Permissions (fine-grained capabilities)
├── id (UUID)
├── key (e.g., "profiles:view", "profiles:edit", "profiles:delete", "registrations:create", "registrations:collect", "events:manage")
├── description
├── created_at, updated_at

RolePermissions (maps roles to permissions)
├── id (UUID)
├── role_id (FK)
├── permission_id (FK)
├── created_at

AccountProfileRoles (links accounts to profiles with specific roles)
├── id (UUID)
├── account_id (FK)
├── profile_id (FK)
├── role_id (FK)
├── granted_at
├── created_at, updated_at

ProfileInvitations (pending invites for accounts to join profiles with specific roles)
├── id (UUID)
├── profile_id (FK)
├── invited_account_id (FK — account being invited)
├── invited_by_account_id (FK — account that sent the invite)
├── role_id (FK — role to be granted upon acceptance)
├── token (text — opaque URL token for the invite link)
├── status ("pending" | "accepted" | "rejected")
├── accepted_at (NULL until accepted)
├── rejected_at (NULL until rejected)
├── expires_at (timestamptz — default now() + interval '14 days')
├── created_at, updated_at
# UNIQUE (token)
```

**Post-MVP permission model.** Profiles no longer carry a hard-coded owner column; what a profile "can do" is determined by the roles assigned to accounts via `AccountProfileRoles`. Owner (the account that created the profile) can do anything including delete; Admin can do most things except delete; Assistant can perform limited actions like collecting registrations at events. `Accounts.is_platform_admin` still bypasses profile-level permission checks.

**Permission enforcement design (server side).** Design principles retained from the original document:

1. **Server is authoritative, UI is UX.** Every allow/deny decision is re-made server-side on every request.
2. **Two-layer check on every mutation.** Layer A — does the caller hold permission `P`? Layer B — does the target resource belong to the profile scope where they hold it? Skipping B is the classic IDOR bug.
3. **Permissions are code, not strings.** The `Permissions` table is for admin UI and audit; the canonical list is a TypeScript enum, and the DB is seeded from it.
4. **Cache the resolved set, not the joins.** Compute `Permissions(account, profile) → Set<PermissionKey>` once per request context; reuse across handlers and response shaping.
5. **404 for unauth reads of non-public resources, 403 for unauth writes and public reads.** Don't leak resource existence through 403s.

Sketch: a `preValidation` Fastify plugin builds a `request.ctx` per request and an async `permissionsFor(profileId)` backed by an in-process LRU. Route definitions carry `config: { requires: { permission, scope } }` and a shared `authorize` `preHandler` runs both layers. Cache invalidation is driven by Postgres `LISTEN`/`NOTIFY` on writes to role-related tables and `Accounts.is_platform_admin`. Full request-pipeline detail lives in the retained-history block below.

### Reviews, comments, and reactions (post-MVP)

```sql
Comments
├── id (UUID)
├── profile_id (FK — Profiles entry indicating which profile authored the comment)
├── text
├── rating (1-5, nullable — set only for reviews of an event or open_mic)
├── created_at, updated_at
# No soft-delete columns: a deleted comment is not recoverable.
# Exactly one typed target association below must exist for each comment; a transaction-level association trigger rejects zero or multiple target rows.
# Threaded replies use CommentComments; deleting a comment cascades to its replies.
# A review is a Comment linked through CommentEvents or CommentOpenMics with rating IS NOT NULL.
# The UI shows an "edited" indicator when updated_at > created_at (no separate edited_at column).

CommentMedia            (comment_id PK/FK, media_id FK, created_at)
CommentComments         (comment_id PK/FK, parent_comment_id FK, created_at)
CommentEvents           (comment_id PK/FK, event_id FK, created_at)
CommentOpenMics         (comment_id PK/FK, open_mic_id FK, created_at)
CommentPrivateMessages  (comment_id PK/FK, private_message_id FK, created_at)
CommentSuggestions      (comment_id PK/FK, suggestion_id FK, created_at)

Reactions
├── id (UUID)
├── type ("like" | "upvote")
├── created_at, updated_at

ReactionMedia            (reaction_id PK/FK, media_id FK, profile_id FK)
ReactionComments         (reaction_id PK/FK, comment_id FK, profile_id FK)
ReactionPrivateMessages  (reaction_id PK/FK, private_message_id FK, profile_id FK)
ReactionSuggestions      (reaction_id PK/FK, suggestion_id FK, profile_id FK)
```

**Comment and review moderation.** Moderation is post-publication: comments and reviews are visible immediately after a successful write. There is no approval queue. Authors may edit or permanently delete their own comments/reviews; the owning organizer may permanently delete comments/reviews attached to media, events, or open-mics in that organization. Because comments are not soft-deleted, a moderation removal is a hard delete and cascades to replies and reactions.

**Rating aggregation (`OpenMics` and `Events`, post-MVP).**

- `rating_avg` and `rating_count` columns denormalize the review aggregates so directory, event, and series pages do not calculate `AVG` on every request.
- A single review-aggregation trigger on `Comments` and the typed review associations handles `INSERT`, `UPDATE` (rating or target change), and hard-delete. It recomputes from source `Comments` rows rather than incrementing counters, making it idempotent and allowing backfilling.
- Soft-deleting an open mic or event excludes its reviews from reads and aggregate queries without deleting the reviews; restoring it makes the reviews and aggregates visible again.

### Media pipeline (promoted to Phase 1)

The `Media` and `PendingS3Deletions` tables — plus the `OpenMicFeaturedMedia` join table added for the series-page Featured strip — shipped in the Phase 1 media slice; see the [Phase 1 schema](#phase-1-schema-current) section. What remains deferred from the earlier media thinking: reactions/comments on media (covered by the reviews/comments/reactions appendix sections), AV scanning, on-the-fly rendition resizing, and the per-item takedown flow for free-standing media depicting a consent-revoked person (see [../../media-gallery-design.md](../media-gallery-design.md) §16).

### Private messaging and notifications (post-MVP)

```sql
PrivateMessages
├── id (UUID)
├── sender_profile_id (FK — Profiles entry)
├── receiver_profile_id (FK — Profiles entry)
├── text
├── read_at (NULL if unread)
├── created_at, deleted_at, deleted_by_profile_id (FK, nullable), recovery_deadline

Suggestions (site-wide suggestion box — feedback about the openmics.org website/product only)
├── id (UUID)
├── account_id (FK — the account that posted the suggestion; account-scoped, not profile-scoped)
├── title
├── body (text)
├── status ("open" | "under_review" | "planned" | "in_progress" | "shipped" | "declined" | "duplicate") — default "open"
├── admin_notes (text, nullable — internal, only visible to platform admins)
├── tags text[]
├── created_at, updated_at
├── deleted_at, deleted_by_profile_id (FK, nullable), recovery_deadline

Notifications (in-app inbox + email debounce state; one row per notifiable event)
├── id (UUID)
├── recipient_profile_id (FK — Profiles entry the notification is for)
├── type ("private_message" | "comment" | "reply" | "reaction" | "review" | "review_response")
├── actor_profile_id (FK, nullable — Profiles entry that triggered it; NULL for system-generated)
├── entity_type ("private_message" | "comment" | "reaction")
├── entity_id (UUID)
├── preview (text, nullable — short denormalized snippet for display)
├── read_at (timestamptz, nullable)
├── email_required (boolean, default true)
├── email_sent_at (timestamptz, nullable — set atomically by the debounce sweep)
├── created_at
```

**Notification read state and email debounce.** `Notifications.read_at` reflects the recipient having viewed the *specific source content*, not merely the inbox list. A scheduled sweep (EventBridge, every 1 minute) claims and sends debounced email notifications atomically via `UPDATE ... FOR UPDATE SKIP LOCKED` so a row can never be claimed twice. The 5-minute debounce threshold and 1-minute sweep cadence are independent knobs.

### Unified deletion journal (post-MVP)

```sql
Deletions (append-only journal of soft deletions across entity types)
├── id (UUID)
├── entity_type ("profile" | "open_mic" | "event" | "registration"
│                | "performance" | "media" | "private_message" | "suggestion")
├── entity_id (UUID)
├── deleted_by_profile_id (FK — Profiles entry of who deleted)
├── deleted_at
├── recovery_deadline
├── restored_at (NULL until restored; row remains for audit)
├── purged_at (NULL until hard-deleted by the purge job)
├── created_at
# INDEX (entity_type, entity_id); INDEX (deleted_at); INDEX (recovery_deadline)
```

The unified journal is intended to power a shared recycle-bin UI and a scheduled purge job. Phase 1 uses per-table soft-delete columns only; the journal ships when a cross-resource recycle-bin surface is actually needed.

### Account lifecycle and deletion policy (post-MVP)

- Account deletion uses a two-stage lifecycle: immediate disable plus a default 30-day recovery window, with an allowed 90-day maximum for edge cases or abuse investigation.
- During the recovery window, the user may request a data export and may restore a deleted account or profile. Login and account-level write operations are blocked immediately after deletion request, while public profile visibility is reduced to a neutral "deleted account" label.
- Final purge removes personal data, access credentials, and non-essential profile metadata once the retention window closes.
- Immutable audit records, moderation events, security incidents, and compliance artifacts are retained in a separate immutable log stream keyed by anonymized references.

### Plans and quotas (post-MVP simplified model)

- `Accounts.plan` (`"free" | "pro"`, default `"free"`) is the only billing/quota state envisaged for the first pass. No `Plans`, `Subscriptions`, or `UsageCounters` tables.
- Limits live as a constants map in code so changing a threshold is a code change, not a migration. The intended shape:
  ```js
  export const PLAN_LIMITS = {
    free: {
      media_bytes:             5 * 1024 ** 3,
      media_count:             500,
      profiles:                1,
      open_mics:               1,
      events_per_month:        10,
      registrations_per_event: 50,
      team_size:               4,
      features:                [],
    },
    pro: {
      media_bytes:             500 * 1024 ** 3,
      media_count:             50_000,
      profiles:                100,
      open_mics:               100,
      events_per_month:        1_000,
      registrations_per_event: 500,
      team_size:               100,
      features:                ['custom_theme', 'unlisted_profile', 'csv_export'],
    },
  };
  ```
- A `checkQuota(account, dimension, delta)` middleware runs on every write path. For profile-scoped dimensions it resolves to the owner account of the profile being written to.
- Every write response would include `X-Quota-<Dimension>-Used` / `X-Quota-<Dimension>-Limit` headers so the frontend can render meters and upgrade CTAs. The `QUOTA_EXCEEDED` error code in [api-design.md](api-design.md#5-api-architecture) is already stable so quotas can be added without a follow-up contract change.
- Migration path when we start charging: create `Plans`, move `PLAN_LIMITS` into `Plans.limits JSONB`, add `Subscriptions`, then add Stripe fields and a `/webhooks/stripe` endpoint. `UsageCounters` only if live SUM/COUNT stops being fast enough.
