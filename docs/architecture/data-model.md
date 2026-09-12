# Data Model

**Related:** [../4-open-mic-technical-architecture.md](../4-open-mic-technical-architecture.md)

---

## 4) Data Model (Key Entities)

```sql
Accounts
├── id (UUID)
├── cognito_id
├── email
├── display_name
├── city (optional)
├── preferred_language (text, nullable — BCP 47 tag e.g. 'en', 'ga', 'fr'; drives the frontend's i18n locale resolution when set; NULL means "honour the browser")
├── current_profile_id (FK to Profiles, nullable — indicates which profile user is currently using)
├── is_platform_admin (boolean — platform super user, manages entire platform)
├── plan ("free" | "pro") — default "free"; drives quota limits (see Plans & quotas)
├── referred_by_profile_id (FK to Profiles, nullable — referral supplied in a validated Cognito OAuth state value and stored when the application account is first provisioned; never overwritten afterward)
├── referred_at (timestamptz, nullable — set together with referred_by_profile_id during account provisioning)
├── created_at, updated_at
# UNIQUE (email); UNIQUE (cognito_id); CHECK (plan IN ('free','pro'));
# CHECK ((referred_by_profile_id IS NULL) = (referred_at IS NULL));

Profiles (unified performer & organizer identities)
├── id (UUID)
├── created_by_account_id (FK — account that created this profile)
├── slug (text — UNIQUE; used for public URLs like `/profiles/alice-band`)
├── profile_name (e.g., "Solo", "Jazz Band", or open mic series name)
├── profile_kind ("organizer" | "performer" — organizer profiles own open-mic series; performer profiles are the identities selected on registrations)
├── bio
├── profile_image_url (S3 URL or NULL)
├── theme_name (named theme for UI customization; themes defined separately)
├── color_mode ("light" | "dark", nullable) — accompanies theme_name; both are per-profile preferences captured during profile creation and editable afterward via `PATCH /profiles/{id}`
├── visibility ("public" | "unlisted" | "private") — default "public"
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

**Comment and review moderation.** Moderation is post-publication: comments and reviews are visible immediately after a successful write. There is no approval queue or pending moderation state. Authors may edit or permanently delete their own comments/reviews; media owners may permanently delete comments attached to their media; and the owning organizer may permanently delete comments/reviews attached to media, events, or open-mics in that organization, including content authored by performers. Because comments are not soft-deleted, a moderation removal is a hard delete and cascades to replies and reactions as defined above. Moderation actions are authorized server-side and recorded in the audit log where an organizer or platform-admin permission is used.

CommentMedia
├── comment_id (PK, FK → Comments.id ON DELETE CASCADE)
├── media_id (FK → Media.id ON DELETE CASCADE)
├── created_at
# UNIQUE (media_id, comment_id)

CommentComments
├── comment_id (PK, FK → Comments.id ON DELETE CASCADE)
├── parent_comment_id (FK → Comments.id ON DELETE CASCADE)
├── created_at
# UNIQUE (parent_comment_id, comment_id)

CommentEvents
├── comment_id (PK, FK → Comments.id ON DELETE CASCADE)
├── event_id (FK → Events.id ON DELETE CASCADE)
├── created_at
# UNIQUE (event_id, comment_id)

CommentOpenMics
├── comment_id (PK, FK → Comments.id ON DELETE CASCADE)
├── open_mic_id (FK → OpenMics.id ON DELETE CASCADE)
├── created_at
# UNIQUE (open_mic_id, comment_id)

CommentPrivateMessages
├── comment_id (PK, FK → Comments.id ON DELETE CASCADE)
├── private_message_id (FK → PrivateMessages.id ON DELETE CASCADE)
├── created_at
# UNIQUE (private_message_id, comment_id)

CommentSuggestions
├── comment_id (PK, FK → Comments.id ON DELETE CASCADE)
├── suggestion_id (FK → Suggestions.id ON DELETE CASCADE)
├── created_at
# UNIQUE (suggestion_id, comment_id)

Reactions
├── id (UUID)
├── type ("like" | "upvote")
├── created_at, updated_at
# No soft-delete columns: deleting a reaction removes it permanently.
# Exactly one typed target association below must exist for each reaction; a transaction-level association trigger rejects zero or multiple target rows.
# Reactions are editable by their author; updates change `type` and `updated_at`.

ReactionMedia
├── reaction_id (PK, FK → Reactions.id ON DELETE CASCADE)
├── media_id (FK → Media.id ON DELETE CASCADE)
├── profile_id (FK → Profiles.id)
# UNIQUE (media_id, profile_id, type)

ReactionComments
├── reaction_id (PK, FK → Reactions.id ON DELETE CASCADE)
├── comment_id (FK → Comments.id ON DELETE CASCADE)
├── profile_id (FK → Profiles.id)
# UNIQUE (comment_id, profile_id, type)

ReactionPrivateMessages
├── reaction_id (PK, FK → Reactions.id ON DELETE CASCADE)
├── private_message_id (FK → PrivateMessages.id ON DELETE CASCADE)
├── profile_id (FK → Profiles.id)
# UNIQUE (private_message_id, profile_id, type)

ReactionSuggestions
├── reaction_id (PK, FK → Reactions.id ON DELETE CASCADE)
├── suggestion_id (FK → Suggestions.id ON DELETE CASCADE)
├── profile_id (FK → Profiles.id)
# UNIQUE (suggestion_id, profile_id, type)

OpenMics
├── id (UUID)
├── owner_profile_id (FK → Profiles.id)
├── current_handle (FK → Handles.handle, unique)
├── slug (text — legacy/internal identifier, unique)
├── name
├── description (nullable)
├── activities text[]
├── venue_name (NOT NULL)
├── address_line1 (NOT NULL), address_line2 (nullable)
├── postcode (nullable), city (NOT NULL), country (NOT NULL)
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
├── rating_avg (numeric(2,1), nullable — denormalized average of Comments linked through CommentOpenMics where rating IS NOT NULL and the open mic is visible)
├── rating_count (integer, default 0 — denormalized count of the same rows; kept in sync by a trigger on Comments)
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
# INDEX (rating_avg DESC NULLS LAST) WHERE deleted_at IS NULL;
# UNIQUE (slug)

Events
├── id (UUID)
├── open_mic_id (FK)
├── slug (text — URL slug scoped to the open mic, e.g. `july-2026`)
├── title
├── starts_at (timestamptz — date and local start time converted using `time_zone`)
├── ends_at (timestamptz, nullable — local end time converted using `time_zone`)
├── time_zone (text — IANA time zone such as `Europe/Dublin`, used for local editing/display and cutoff calculations)
├── running (boolean, nullable — set true when the organizer starts, false when they stop)
├── registrations_closed_at (timestamptz, nullable — no new registrations after this time)
├── venue_name (NOT NULL — defaults from OpenMics when the event is created)
├── address_line1 (NOT NULL), address_line2 (nullable)
├── postcode (nullable), city (NOT NULL), country (NOT NULL)
├── lat numeric(9,6), lng numeric(9,6) (nullable — defaults from OpenMics when the event is created)
├── location (geography(Point, 4326) GENERATED ALWAYS AS (
│              CASE WHEN lat IS NOT NULL AND lng IS NOT NULL
│                   THEN ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography
│              END) STORED — map location generated from the event's copied coordinates)
├── activities text[]  (nullable — NULL inherits from OpenMics.activities;
│                       when set, replaces the OpenMic's allowed set for this event)
├── tags text[]
├── capacity (integer, nullable)
├── entry_fee_amount (numeric(10,2), nullable — per-event override; NULL inherits from OpenMics.entry_fee_amount)
├── entry_fee_currency (text, nullable — per-event override; NULL inherits from OpenMics.entry_fee_currency)
├── entry_fee_note (text, nullable — per-event override; NULL inherits from OpenMics.entry_fee_note)
├── notes (text, nullable — organizer-only private notes)
├── rating_avg (numeric(2,1), nullable — denormalized average of Comments linked through CommentEvents where rating IS NOT NULL and the event is visible)
├── rating_count (integer, default 0 — denormalized count of the same rows; kept in sync by the review aggregation trigger)
├── created_at, updated_at
├── deleted_at, deleted_by_profile_id (FK, nullable), recovery_deadline
# CHECK (activities IS NULL OR activities <@ ARRAY['singing','poetry','jam','trad','comedy','storytelling','other']);
# CHECK ((lat IS NULL) = (lng IS NULL));
# INDEX GIN (activities); INDEX GIN (tags)
# INDEX GIST (location);
# UNIQUE (open_mic_id, slug)

**Event location snapshot.** The create-event page pre-fills `venue_name`, `address_line1`, `address_line2`, `postcode`, `city`, `country`, `lat`, and `lng` from the selected `OpenMics` row. `POST /events` requires `open_mic_id` and creates the event and its location snapshot in one database transaction. Location is overridden as one atomic input: the request must provide the complete address and geographic location together, including `venue_name`, `address_line1`, `address_line2`, `postcode`, `city`, `country`, `lat`, and `lng`, or provide none of them and inherit the complete parent snapshot. Partial address or coordinate overrides are rejected, and supplied coordinates must pass latitude/longitude bounds checks (`-90..90`/`-180..180`) and be present together or not at all. Coordinates are not re-validated against the address text server-side; the frontend's map/geocoding-assisted location picker (see [API design: Geocoding](api-design.md#geocoding)) is the mechanism that keeps the typed address and the submitted `lat`/`lng` consistent before submission. The generated `Events.location` then supplies the event map pin. An organizer may therefore create a one-off event at another venue, while later edits to the parent open mic never alter existing events.

Registrations
├── id (UUID)
├── event_id (FK)
├── profile_id (FK or NULL for guests, references Profiles for registered performers)
├── performer_name (guest name, required when profile_id is NULL)
├── performer_city (optional)
├── contact_email (nullable — required unless organizer_supervised; used for email confirmation, magic edit links, and user-initiated claim after sign-in)
├── contact_phone (nullable)
├── submission_channel ("organic" | "shared_link" | "email_reminder" | "social_ad" | "poster_qr" | "kiosk" | "prior" — descriptive attribution tag only; does not by itself gate visibility or claim eligibility)
├── organizer_supervised (boolean, default false — true only for registrations entered by an organizer/assistant at the event via the kiosk; the sole gate for immediate public visibility without email verification)
├── referred_by_profile_id (FK to Profiles, nullable — captures which profile's shared link the registrant followed, via a `?ref=<profile_id>` query param on the registration link; invalid/missing values are silently ignored, never rejected)
├── media_consent (boolean)
├── edit_token_hash (text, nullable — SHA-256 hash of the opaque token emailed to guests for magic-link edits; never store the raw token; UNIQUE)
├── edit_token_expires_at (timestamptz, nullable — set to event end plus 30 days; cleared on rotation or expiry)
├── email_verification_token_hash (text, nullable — SHA-256 hash of the opaque one-shot token emailed to guests to confirm ownership of contact_email; never store the raw token; UNIQUE)
├── email_verification_token_expires_at (timestamptz, nullable — set to event start + 24h, or 72h after creation for events further out)
├── verification_method ("email" | "organizer_kiosk" | "authenticated_account", nullable — records how the registration became verified)
├── email_verified_at (timestamptz, nullable — set when the guest confirms contact_email; unless organizer_supervised, a guest row is "pending" and hidden from the public roster and from claim eligibility until this is set)
├── claimed_by_account_id (FK to Accounts, nullable — set only when a signed-in account explicitly claims this guest registration; never populated automatically on Cognito email verification)
├── claimed_at (timestamptz, nullable)
├── created_at, updated_at
├── deleted_at, deleted_by_profile_id (FK, nullable), recovery_deadline
# CHECK (submission_channel IN ('organic','shared_link','email_reminder','social_ad','poster_qr','kiosk','prior'));
# CHECK (organizer_supervised = FALSE OR submission_channel = 'kiosk');   -- organizer_supervised is only ever true for kiosk-originated rows
# CHECK (organizer_supervised OR profile_id IS NOT NULL OR contact_email IS NOT NULL);
# CHECK ((claimed_by_account_id IS NULL) = (claimed_at IS NULL));
# CHECK (claimed_by_account_id IS NULL OR profile_id IS NULL);  -- claiming never silently converts a guest row into a profile registration
# CHECK (verification_method IS NULL OR verification_method IN ('email','organizer_kiosk','authenticated_account'));
# UNIQUE (event_id, profile_id) WHERE deleted_at IS NULL AND profile_id IS NOT NULL
# UNIQUE (edit_token_hash) WHERE edit_token_hash IS NOT NULL
# UNIQUE (email_verification_token_hash) WHERE email_verification_token_hash IS NOT NULL
# INDEX (contact_email) WHERE contact_email IS NOT NULL AND claimed_by_account_id IS NULL
# "My registrations" for a signed-in account = rows where profile_id IN (my profiles) OR claimed_by_account_id = my account.
# "Publicly visible / valid" = rows where organizer_supervised OR email_verified_at IS NOT NULL — applies uniformly across every non-kiosk channel (organic browsing, shared link, email reminder, social ad, poster QR); kiosk rows are visible immediately because the organizer's physical presence substitutes for email proof.
# "Claimable by me" = rows where contact_email = my Cognito-verified email AND claimed_by_account_id IS NULL AND email_verified_at IS NOT NULL — verification is required for claim regardless of channel, including kiosk rows; an unverified kiosk registration is publicly visible but can never be claimed.

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
# When an event is stopped (Events.running -> false), any Performances row that never reached
# "performing" (started_at IS NULL) is soft-deleted alongside the existing "mark unregistered as
# no_show" cleanup, since a valid, reportable performance requires both a start and a finish time.

Media
├── id (UUID)
├── media_type ("photo" | "video")
├── event_id (FK, nullable — set when media is attached to an event)
├── performance_id (FK to Performances, nullable — attributes media to a specific performance)
├── profile_owner_id (FK, nullable — Profiles entry; set for profile-only media)
├── added_by_profile_id (FK — uploader and media owner; the uploader may delete their own media)
├── added_by_role ("performer" | "organizer" — drives grouping/display on event pages)
├── source_url (S3 URL for photos, embedded video URL for videos)
├── mime_type (nullable), size_bytes (bigint, nullable)
├── width (nullable), height (nullable), duration_seconds (nullable — videos)
├── thumbnail_url (nullable — poster frame for videos)
├── video_platform (nullable — "youtube" | "vimeo" | "instagram" | ...)
├── platform_video_id (nullable — canonical ID on that platform)
├── caption (nullable)
├── created_at, updated_at, deleted_at, deleted_by_profile_id (FK, nullable), recovery_deadline

**Media ownership and organization moderation.** `added_by_profile_id` is the uploader/owner; `profile_owner_id` identifies the profile whose page owns profile-only media and is not a substitute for uploader ownership. The uploader may delete their own media. The organizer who owns the associated open-mic profile may edit or delete any media belonging to that organization, including media uploaded by performers. Organization scope is derived from the media's event, performance registration, or profile association. Organizer authority applies to media edits and soft-deletes but does not change the uploader attribution or `added_by_role` history.

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
# CHECK (status IN ('open','under_review','planned','in_progress','shipped','declined','duplicate'));
# INDEX (status); INDEX GIN (tags)
# Scope: Suggestions are for site-wide product feedback ONLY (features, bugs, policy, UX).
#   - NOT for feedback about a specific open mic, event, or profile.
#   - Feedback about a specific open mic or event goes through reviews (Comments with rating on the event/open_mic).
#   - Feedback about a specific profile goes through a private message to that profile.
# There is no foreign key from Suggestions to any content entity; suggestions never reference an open_mic/event/profile id.
# Replies use `CommentSuggestions`; upvotes use `ReactionSuggestions`.
# Only platform admins may change `status` or write `admin_notes`.

Deletions (append-only journal of soft deletions across entity types)
├── id (UUID)
├── entity_type ("profile" | "open_mic" | "event" | "registration"
│                | "performance" | "media" | "private_message" | "suggestion")
├── entity_id (UUID — id of the soft-deleted row in its origin table)
├── deleted_by_profile_id (FK — Profiles entry of who deleted)
├── deleted_at
├── recovery_deadline
├── restored_at (NULL until restored; row remains for audit)
├── purged_at (NULL until hard-deleted by the purge job)
├── created_at
# INDEX (entity_type, entity_id); INDEX (deleted_at); INDEX (recovery_deadline)
# One row per soft-delete event; not the source of truth for the entity itself.

PendingS3Deletions (queue of S3 objects to delete; S3 is never deleted inline)
├── id (UUID)
├── bucket
├── object_key
├── media_id (FK to Media, nullable — original media row if still known)
├── reason ("purge" | "replace" | "abandoned_upload" | "manual")
├── scheduled_for (when the S3 delete worker may process this row)
├── attempts (integer, default 0)
├── last_error (nullable)
├── created_at
├── processed_at (NULL until the S3 object has been deleted)
# INDEX (processed_at, scheduled_for); INDEX (bucket, object_key)

Notifications (in-app inbox + email debounce state; one row per notifiable event)
├── id (UUID)
├── recipient_profile_id (FK — Profiles entry the notification is for)
├── type ("private_message" | "comment" | "reply" | "reaction" | "review" | "review_response")
├── actor_profile_id (FK, nullable — Profiles entry that triggered it; NULL for system-generated)
├── entity_type ("private_message" | "comment" | "reaction" — origin table of entity_id; redundant with `type` but stored so any consumer can resolve the origin table without duplicating the type→table mapping; a CHECK constraint pins the pairing so it can never drift from `type`)
├── entity_id (UUID — id of the row in its origin table; enforced in app layer)
├── preview (text, nullable — short denormalized snippet for display, e.g. message/comment excerpt)
├── read_at (timestamptz, nullable — set when the recipient views the source content, not merely the inbox list)
├── email_required (boolean, default true — false for types that are in-app only)
├── email_sent_at (timestamptz, nullable — set atomically by the debounce sweep when it claims the row for sending)
├── created_at
# CHECK (type IN ('private_message','comment','reply','reaction','review','review_response'));
# CHECK (entity_type IN ('private_message','comment','reaction'));
# CHECK (                                                            -- entity_type is derived from type; this pins the pairing so the two columns can never disagree
#   (type = 'private_message' AND entity_type = 'private_message')
#   OR (type IN ('comment','reply','review','review_response') AND entity_type = 'comment')
#   OR (type = 'reaction' AND entity_type = 'reaction')
# );
# INDEX (recipient_profile_id, read_at) WHERE read_at IS NULL              -- unread list + unread count
# INDEX (email_required, email_sent_at, created_at) WHERE read_at IS NULL AND email_required AND email_sent_at IS NULL  -- debounce sweep
```

**Notification read state and email debounce:**
- `Notifications.read_at` reflects the recipient having viewed the *specific source content* (opened the conversation thread, viewed the commented media, etc.), not merely having the inbox list open. The handler that marks source content read (e.g. `PUT /messages/:id/mark-read`) also sets `read_at` on the corresponding `Notifications` row(s) in the same transaction.
- A scheduled sweep (EventBridge, every 1 minute) claims and sends debounced email notifications atomically to avoid double-sends across overlapping runs:
  ```sql
  UPDATE Notifications
  SET email_sent_at = now()
  WHERE id IN (
    SELECT id FROM Notifications
    WHERE read_at IS NULL
      AND email_required
      AND email_sent_at IS NULL
      AND created_at <= now() - interval '5 minutes'
    ORDER BY created_at
    LIMIT 500
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
  ```
  Rows returned by this statement are enqueued to the email SQS queue; the `UPDATE` is the only place `email_sent_at` is set, so a row can never be claimed twice even if two sweep invocations overlap.
- The 5-minute debounce threshold and the 1-minute sweep cadence are independent knobs: the cadence only bounds how promptly a stale unread notification is picked up, not the debounce window itself.
- This mechanism generalizes across all `Notifications.type` values (comments, reviews, reactions, private messages), not just messages — each source-content "mark read" handler is responsible for updating its corresponding `Notifications` rows.

**Soft-delete / recycle bin model:**
- Every soft-deletable table (`Profiles`, `OpenMics`, `Events`, `Registrations`, `Performances`, `Media`, `PrivateMessages`, and `Suggestions`) carries `deleted_at`, `deleted_by_profile_id`, and `recovery_deadline`. `Comments` and `Reactions` are not soft-deleted.
- Reads filter on `deleted_at IS NULL`; restore = `UPDATE ... SET deleted_at = NULL, deleted_by_profile_id = NULL, recovery_deadline = NULL` and set `Deletions.restored_at = now()`.
- Unified recycle bin UI is served from the `Deletions` journal: one row is appended on every soft-delete, with `entity_type` + `entity_id` pointing back to the origin table for details.
- A scheduled EventBridge purge job hard-deletes origin rows where `recovery_deadline < now()` and sets `Deletions.purged_at`.
- For `Media`, the purge job does **not** delete the S3 object directly. It inserts a row into `PendingS3Deletions` (with `reason = "purge"`); a separate S3 delete worker processes that queue.
- Soft-deleting an associated entity does not delete its comments or reactions; visibility queries exclude them while the associated entity is hidden, and restoration makes them visible again.
- Hard-deleting an `OpenMics`, `Events`, `Media`, `PrivateMessages`, or `Suggestions` row cascades through its typed comment/reaction association tables. Hard-deleting a `Comments` row cascades to its `CommentComments` replies and all reaction associations targeting that comment. No comment or reaction remains attached to a fully deleted entity.
- Any `UNIQUE` constraint that should ignore deleted rows (e.g., unique registration per event+profile) is a partial unique index `WHERE deleted_at IS NULL`.
- Partial index `WHERE deleted_at IS NOT NULL` on each soft-deletable table keeps hot reads clean.

**Account lifecycle, retention, and deletion policy:**
- Account deletion uses a two-stage lifecycle: immediate disable plus a default 30-day recovery window, with an allowed 90-day maximum for edge cases or abuse investigation. The default is intentionally short enough to avoid indefinite retention while still permitting user reversal of an accidental action.
- During the recovery window, the user may request a data export and may restore a deleted account or profile if the platform allows restoration. Login and account-level write operations are blocked immediately after deletion request, while public profile visibility is reduced to a neutral "deleted account"/"former member" label for history-bearing public content.
- Final purge removes personal data, access credentials, and non-essential profile metadata once the retention window closes; remaining public content is either anonymized or left with neutral attribution only where historical continuity is required.
- Immutable audit records, moderation events, security incidents, and compliance artifacts are retained in a separate immutable log stream and are never deleted, but they are keyed by anonymized references rather than live account identifiers wherever possible.
- Export data includes account/profile metadata, event and registration history, media references, and notification records in a portable format; it is generated before purge and is not included in the public-facing history log.
- Notification email policy defaults are fixed in MVP: 5-minute unread debounce for outbound emails, 1-minute sweep cadence, and a conservative per-account send rate limit of 1 email/sec with a burst guard for SES. `NotificationPreferences` remain explicitly deferred unless product validation shows a clear need after launch.

**MVP authorization scope:**
- Multi-admin collaboration is post-MVP. During MVP, the account in `Profiles.created_by_account_id` is the sole owner and the only account that can manage that profile's open mics, events, registrations, media, and settings.
- MVP authorization checks the authenticated account against `created_by_account_id` for profile-scoped mutations; platform admins retain their platform-level bypass.
- `Roles`, `Permissions`, `RolePermissions`, `AccountProfileRoles`, and `ProfileInvitations` are reserved for the post-MVP collaboration release. They are not required on MVP request paths, and invitations, membership changes, team quotas, and role-management UI are excluded from the MVP delivery plan.

**Onboarding and profile-scoped preferences:**
- An account should never be left without at least one profile in practice. This is enforced client-side: after first sign-in, the frontend blocks all other routes behind a mandatory onboarding step (asking performer vs. organizer, plus theme/color_mode) until `POST /profiles` has created a first profile and `PUT /accounts/{id}/current-profile` has selected it. It is not a hard database constraint, since `profile_kind` is not known until the user answers the onboarding question.
- `theme_name` and `color_mode` are profile-level preferences, not account-level, because a single account may hold both a performer and an organizer profile that should look different. `AccountUpdateRequest` (display_name, city, preferred_language) intentionally excludes them.
- The same theme/color_mode selection UI is reusable whenever any new profile is created, not just during onboarding.

**Post-MVP permission-based design:**
- **Profiles** no longer have a type; instead, what a profile "can do" is determined by the roles assigned to accounts via `AccountProfileRoles`.
- **Accounts** have roles (Owner, Admin, Assistant, Performer, Organizer, etc.) on specific profiles via `AccountProfileRoles`.
- **Roles** map to fine-grained `Permissions` via `RolePermissions`.
- **Owner** (account that created the profile) can do anything, including delete the profile.
- **Admin** can do most things except delete.
- **Assistant** can perform limited actions like collecting registrations at events.
- Permissions are queryable in the UI and checked on all API calls.

**Platform admin (super user):**
- `Accounts.is_platform_admin` flag indicates platform-level super users
- Platform admins bypass profile-level permission checks
- Can manage system-level resources (roles, permissions, user accounts, platform settings)
- API check: if `account.is_platform_admin`, grant all operations; else, check profile-scoped roles via `AccountProfileRoles`

**Context and permissions flow:**
1. Account logs in, sets current profile via `current_profile_id` in Accounts table
2. For any action, API first checks `is_platform_admin`:
   - If true, allow (or enforce platform-specific permission checks if needed)
   - If false, look up `AccountProfileRoles(account_id, profile_id)`
3. API resolves roles → permissions via `RolePermissions` and `Permissions` tables
4. API enforces permission checks before processing requests
5. Frontend queries `GET /profiles/:id/roles` to display UI elements based on user's permissions; all API calls use the `/api` base URL defined in [`openapi.yaml`](../../openapi.yaml).

**Permission enforcement design (server side):**

The rules above describe *what* is checked; this subsection specifies *how* the API enforces it in a way that stays fast under load and closes the common authorization pitfalls (IDOR, stale JWTs, list-endpoint over-fetch).

Five design principles:

1. **Server is authoritative, UI is UX.** Every allow/deny decision is re-made server-side on every request. The client's rendered state is never trusted.
2. **Two-layer check on every mutation.** *Layer A* — does the caller hold permission `P`? *Layer B* — does the target resource belong to the profile scope where they hold it? Skipping B is the classic IDOR bug.
3. **Permissions are code, not strings.** The `Permissions` table is for admin UI and audit; the canonical list is a TypeScript enum, and the DB is seeded from it. Typos become compile errors and OpenAPI exports the enum for the frontend.
4. **Cache the resolved set, not the joins.** Compute `Permissions(account, profile) → Set<PermissionKey>` once per request context; reuse across handlers and response shaping.
5. **404 for unauth reads of non-public resources, 403 for unauth writes and public reads.** Don't leak resource existence through 403s.

**Request pipeline (Fastify).** A single `preValidation` plugin builds a `request.ctx` per request with `accountId`, `isPlatformAdmin`, `currentProfileId`, and an async `permissionsFor(profileId)`. `permissionsFor` reads from an in-process LRU keyed on `(accountId, profileId)`; on miss it issues one indexed join:

```sql
SELECT p.key
FROM AccountProfileRoles apr
JOIN RolePermissions rp ON rp.role_id = apr.role_id
JOIN Permissions p       ON p.id      = rp.permission_id
WHERE apr.account_id = $1 AND apr.profile_id = $2
```

Under load the LRU covers >95% of requests, so this query is cold path (~1–2 ms) and the hot path is a Set lookup (~10 µs).

**Declarative route metadata.** Route definitions carry the required permission and a scope resolver; a shared `authorize` `preHandler` reads them and runs both layers:

```ts
fastify.route({
  method: 'PUT',
  url: '/events/:id',
  config: { requires: { permission: 'events:manage', scope: 'event' } },
  preHandler: authorize,
  handler: updateEvent,
})
```

`scope: 'event'` tells `authorize` to derive the owning `profile_id` from the URL params (`events` → `profile_id`, `openMics` → `profile_id`, `registrations` → the event's `profile_id`). Layer B is what stops a caller who holds `events:manage` on profile X from mutating an event on profile Y.

**Platform-admin short-circuit.** `is_platform_admin` is sourced from the DB inside `permissionsFor`, **never trusted from a JWT claim** — Cognito ID tokens live too long (up to an hour) for a revoked admin to be safely bounced by token expiry alone. If true, `authorize` skips both layers.

**Cache invalidation.** Any write to `AccountProfileRoles`, `RolePermissions`, `Roles`, or `Accounts.is_platform_admin` publishes a `permissions:invalidate` message via Postgres `LISTEN`/`NOTIFY`; every Fastify process subscribes and drops matching LRU entries. TTL (60 s) is the safety net if the channel drops a message.

**List endpoints filter in SQL.** For "events I can manage" and similar, embed the permission predicate directly (`WHERE profile_id IN (SELECT profile_id FROM AccountProfileRoles WHERE account_id = $1 AND role_id IN (:roles_with_permission))`). Never fetch-then-filter — that scales with total row count instead of the caller's role fan-out.

**Response envelope carries permission state.** On success, mutation and detail responses include `X-Current-Profile-Permissions: events:manage,registrations:collect,…` so the frontend can refresh its cache without a separate round trip. On failure, the standard error envelope carries `code: PERMISSION_DENIED` with the missing key.

**Audit log.** Any action gated by `roles:*`, `profiles:manage_roles`, or a platform-admin route writes an `AuditLog` row (actor, action, target, before/after) inside the same transaction as the mutation. Non-privileged actions do not — that would be write amplification.

**Throughput & footprint.** With an LRU of `active_users × active_profiles_per_user × ~200 bytes`, the process resident set for permission caching stays in single-digit MB even at a few hundred thousand concurrent sessions. Pub/sub invalidation carries a few messages per minute in steady state.

**Threats explicitly addressed:** stale-token abuse after role revocation (DB-sourced, not JWT-sourced), IDOR across profile scopes (Layer B), enumeration of private resources via 403 (404 policy), and races between a mutation and a concurrent role change (permission set is re-read inside the mutation's transaction before commit).

**Non-goals for v1.** No ABAC / policy engine (OPA, Cedar) — the current permission catalog doesn't need attribute rules. No delegated tokens or scoped API keys — no third-party read access yet. No field-level permission stripping — currently handled by response shaping per role; formalize only if the matrix grows.

**Event media attribution note:** `Media.added_by_role` ("performer" | "organizer") is inferred from the roles an account has on the profile that added the media, driving display grouping on event pages.

**Rating aggregation (`OpenMics` and `Events`):**
- `rating_avg` and `rating_count` are denormalized so directory, event, and series pages do not calculate `AVG` on every request.
- A single review-aggregation trigger on `Comments` and the typed review associations handles `INSERT`, `UPDATE` (rating or target change), and hard-delete. It recomputes the affected `OpenMics` rows through `CommentOpenMics` and `Events` rows through `CommentEvents` whenever `rating IS NOT NULL`.
- The trigger recomputes from source `Comments` rows rather than incrementing counters, making it idempotent and allowing backfilling with explicit `UPDATE OpenMics` and `UPDATE Events` statements.
- Soft-deleting an open mic or event excludes its reviews from reads and aggregate queries without deleting the reviews; restoring it makes the reviews and aggregates visible again.

**Directory listing rules (`GET /open-mics`, `GET /open-mics/map`):**
- Every open mic must have an owning `profile_id` at creation — the caller's current profile becomes the owner. There is no unclaimed / third-party-listing state in v1; ownership verification is deferred.
- The directory excludes rows with `status IN ('draft','ended')` and `deleted_at IS NOT NULL`. `paused` rows are still returned with a visible "On break" indicator so the entry doesn't disappear from search when the organizer takes a temporary hiatus.
- Guest registration claiming applies only to event `Registrations` — there is no equivalent "claim an open mic" flow. Ownership transfer between profiles is a manual admin operation for now.

**Registration flows (self-serve with email confirmation, walk-in kiosk, user-initiated guest claim, magic-link editing):**
- All frontend entry points share the same `POST /events/:id/registrations` endpoint; `submission_channel` is a descriptive attribution tag only (`"organic"`, `"shared_link"`, `"email_reminder"`, `"social_ad"`, `"poster_qr"`, `"kiosk"`), and `organizer_supervised` is the only field that changes verification/visibility behavior.
- **Self-serve** (public): any visitor to `/events/:eventId/register`, regardless of whether they arrived by organic browsing, a shared link, an email reminder, a social ad, or a poster QR code — the page and the verification rule are identical across all of these. If signed in, the caller must select a separate account-owned profile with `profile_kind='performer'`; the registration is immediately valid with `verification_method='authenticated_account'`. An organizer may register for their own event only after creating and selecting such a performer profile; the organizer profile itself cannot be used as the performer identity. Organizer permissions do not bypass capacity, ordering, visibility, or verification rules. If the account has no performer profile, the UI offers inline performer-profile creation. If not signed in, the visitor supplies `performer_name` and a **required** `contact_email`; the row is created with `email_verified_at IS NULL` (pending) and is excluded from the public roster and from event roster caps until confirmed.
- **Email confirmation for self-serve guests:** on create, the API generates a one-shot `email_verification_token`, stores only its SHA-256 hash plus `email_verification_token_expires_at`, and enqueues an email with a link to `https://openmics.org/events/:eventId/register/verify?token=<verification_token>`. `POST /registrations/:id/verify-email` hashes the supplied token, compares it in constant time, sets `email_verified_at` and `verification_method='email'`, then clears the hash and expiry before triggering the standard post-registration flow (including the magic edit-link email). Pending rows past a TTL (event start + 24h, or 72h after creation for events further out) are hard-deleted by a background sweep so no unconfirmed row lingers as a claimable target.
- **Walk-in kiosk** (organizer/assistant only, `organizer_supervised=true`): requires `registrations:collect` permission on the event's open-mic profile. The kiosk page loops — register a performer, confirm, reset the form for the next walk-in. The registration is publicly visible immediately regardless of email state, because the organizer's physical presence substitutes for email proof. Set `verification_method='organizer_kiosk'` at creation. If `contact_email` is supplied (optional for kiosk rows), the API also sends a one-shot verification email using the hashed token flow; a later successful confirmation changes the method to `email`. If the attendee never confirms, the method remains `organizer_kiosk`, and the row cannot be claimed until email verification occurs. The kiosk UI encourages every walk-in to supply and verify an email, explaining the concrete benefit: only a verified email lets them later find and claim this exact attendance from their own account.

- **Magic-link editing:** on registration create (once publicly visible — i.e. after email confirmation for self-serve, immediately for kiosk), if `contact_email` is set, the API generates a random opaque `edit_token`, stores only its SHA-256 hash plus `edit_token_expires_at`, and enqueues an email containing a link like `https://openmics.org/events/:eventId/register?token=<edit_token>`. The resolve endpoint is rate-limited per IP and registration, never logs or echoes the raw token, returns `Cache-Control: no-store` and `Referrer-Policy: no-referrer`, and exchanges a valid URL token for a short-lived, HttpOnly, Secure, SameSite=Lax edit-session cookie. The browser then uses that cookie for `GET`/`PUT` of the specific registration; raw URL tokens are not retained in application state or sent to downstream pages. Tokens are valid until the event ends + 30 days, after which the hash and expiry are cleared. They can be rotated by the owner or an organizer via `POST /registrations/:id/rotate-edit-token`, which invalidates the previous hash immediately. Access-token values are redacted from application, access, analytics, and email-provider logs.
- **User-initiated guest → account claim:** a signed-in account calls `GET /me/claimable-registrations` to list guest registrations where `contact_email` matches the account's Cognito-verified email, `claimed_by_account_id IS NULL`, and `email_verified_at IS NOT NULL` — this verification requirement applies uniformly to every channel, including kiosk rows, so an unverified walk-in registration can never be claimed later no matter how it was entered. The client offers a per-row **Claim** action (and optionally "Claim all") that calls `POST /registrations/:id/claim`; the server re-checks the email match against the caller's verified identity, then sets `claimed_by_account_id` and `claimed_at`. `profile_id` remains `NULL` — the registration stays guest-attributed on public listings but appears in the claiming account's "My registrations" list. **Claim is never triggered by Cognito email verification alone**; the user must open the claim UI and confirm the row(s).
- **Referral attribution:** any shareable public page — event detail, event register, open-mic detail/register, or profile detail — may carry `?ref=<profile_id>` identifying the profile whose share link was followed (e.g. a performer forwarding an event link to a friend). The client captures this from whichever page it first appears on (not only the register page), persists it locally, and attaches it to whichever conversion happens next:
  - **Registration:** resolved to `Registrations.referred_by_profile_id` on `POST /events/:id/registrations`.
  - **Account sign-up:** when the visitor begins the Cognito hosted-UI flow, the client places the stored referral in a signed, single-use OAuth `state` value bound to the browser's auth nonce. After Cognito returns successfully, Fastify validates and consumes that state while it first provisions the application `Accounts` row, setting `referred_by_profile_id` and `referred_at` in the same transaction. There is no follow-up referral endpoint and no period in which a newly created account can be retrospectively attributed.
  - An unrecognized, expired, or missing `ref` value is always silently ignored on both paths rather than rejected — the referred link must keep working even if the referrer's profile is later renamed, hidden, or deleted, and a bad value never blocks registration or sign-up.

**Smart registration links and QR codes (event-specific and "next scheduled event"):**
- **Event-specific link/QR:** `/events/:eventId/register` (existing) — always points at one fixed event, for posters printed after a specific date is confirmed.
- **Open-mic "next event" link/QR:** `GET /open-mics/:id/register` (and its vanity form `/@:handle/register`) is a durable link an organizer can put on a permanent poster or flyer once and never reprint. The server resolves it via `GET /open-mics/:id/next-event` (public, cacheable) to the soonest upcoming, not-yet-closed event under that open mic and forwards the visitor to that event's `/events/:eventId/register` page. If no upcoming event exists, the page renders a fallback instead of a broken link or 404: the open mic's `schedule_summary` (and `schedule_details` if present), telling the visitor plainly when the next event is expected (e.g. "No event is currently open for registration. This open mic usually runs: Every 2nd Tuesday, 8pm.").
- Both link forms accept the `?ref=<profile_id>` referral parameter described above and carry it through the server-side redirect.
- The organizer console exposes one-tap **Copy link** and **Download QR code** actions for both link types, so a non-technical organizer can hand out a scannable poster or share a link without understanding the underlying resolution logic.
- The organizer's kiosk view is served by `GET /events/:id/registrations` filtered by permission, and the kiosk's "view all / edit" buttons target `PUT /registrations/:id` — same as any organizer edit.

**Plans & quotas (MVP simplified model):**
- `Accounts.plan` (`"free" | "pro"`, default `"free"`) is the only billing/quota state we store for now. No `Plans`, `Subscriptions`, or `UsageCounters` tables yet.
- Limits and features live as a constants map in code (`src/config/plans.js`), so changing a threshold is a code change, not a migration:
  ```js
  export const PLAN_LIMITS = {
    free: {
      media_bytes:             5 * 1024 ** 3,   // 5 GB
      media_count:             500,
      profiles:                1,               // profiles per account (open-mic or performer identities)
      open_mics:               1,               // open-mic series per organizer profile
      events_per_month:        10,
      registrations_per_event: 50,
      team_size:               4,               // accounts with roles on a single profile
      features:                [],
    },
    pro: {
      media_bytes:             500 * 1024 ** 3, // 500 GB
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
- Pro is assigned manually (by a platform admin) to developer, staff, or partner accounts until self-serve billing exists.
- A `checkQuota(account, dimension, delta)` middleware runs on every write path. For profile-scoped dimensions (team_size, open_mics, events_per_month, registrations_per_event, media_bytes, media_count) it resolves to the **owner account of the profile being written to** — team members do not consume their own quota on someone else's profile.
- Usage is computed on-demand (SUM/COUNT on source tables such as `Media.size_bytes`); no denormalized counters yet. Cache per-profile results in memory for a short TTL if a hot endpoint becomes chatty.
- Every write response includes `X-Quota-<Dimension>-Used` and `X-Quota-<Dimension>-Limit` headers for the primary dimension it touched, so the frontend can render meters and upgrade CTAs.
- Migration path when we start charging: (1) create `Plans` table and seed one row per current `plan` key; (2) move `PLAN_LIMITS` into `Plans.limits JSONB` and delete the constants file; (3) create `Subscriptions`, backfill one row per account from `Accounts.plan`, then drop `Accounts.plan`; (4) add Stripe fields to `Subscriptions` and the `/webhooks/stripe` endpoint; (5) add `UsageCounters` only if live SUM/COUNT stops being fast enough.

---
