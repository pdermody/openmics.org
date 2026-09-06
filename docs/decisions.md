# Recorded Decisions

This file records settled decisions that affect more than one planning document.

## Delivery order

- Phase 1 is organizer-first: create and manage open-mic series, create and operate events, manage rosters, and publish organizer-owned photos and video links.
- Performers can sign up, browse open-mics and events, and register in Phase 1.
- Phase 1 public surfaces are read-only for visitors and include the home, profile, open-mic, event, and registration pages.
- Performer-authored content, comments, reviews, reactions, private messaging, follows, and social discovery are deferred until later phases.

## Handles

- Profiles and open-mic series share one global handle namespace.
- Canonical handles preserve owner-selected casing; lookup and uniqueness are case-insensitive.
- Case-only changes are allowed without limit, do not create redirect history, and redirect previous casing to the new canonical URL.
- Changes to any non-case character use the normal rename restrictions: 30-day redirect, 30-day quarantine, and auto-reclaim afterward.
- Owners retain the original guest registration provenance when a registration is claimed or later attributed to a profile.

## Guest Registrations

- Guest registrations may be claimed at any time during or after the event.
- Claiming is explicit and requires a verified email match.
- Adoption of a claiming profile is an explicit public-attribution choice and may be changed later by the registration owner.
- The claim request identifies the adopted profile explicitly (`adopted_profile_id`), since an account may own more than one performer profile.
- A duplicate guest registration is defined as a second row for the same event with the same verified contact email; unverified/pending rows do not block others until confirmed. Enforced by a partial unique index on `(event_id, lower(contact_email))` where `email_verified_at IS NOT NULL`.
- A registration claim is atomic: the first successful claim wins, and a losing concurrent claim attempt fails explicitly with `409` rather than silently overwriting or duplicating attribution.
- Media consent can be revoked after registration, but revocation is future-only: it blocks new media publication under that registration and is not retroactive against media already published. `Registration.media_consent_updated_at` records when consent last changed, for audit purposes.
- Guest registration submission is rate-limited per source (e.g. per IP) to deter abuse; exceeding the limit returns `429`.

## Media

- Organizer-owned media `source_url` is validated server-side: photos must be objects in the platform's own S3 media bucket (via the upload-url flow); videos must link to an allowlisted host (`youtube.com`, `youtu.be`, or `vimeo.com`). Arbitrary hosts are rejected.

## Retention

- Phase 1 soft-deletable records (profiles, open-mics, events, registrations, media) use one uniform window: 30 days recoverable, then hard-deleted by the purge job. This matches the handle redirect/quarantine cadence already in place.

## API Contract

- `openapi.yaml` is reduced to the Phase 1 executable contract. Reviews, comments, reactions, private messaging, suggestions, notifications, follows, multi-admin collaboration roles, public map discovery, and the legacy slug system are removed from the contract (not the product) and tracked as deferred surface in [architecture/api-design.md](architecture/api-design.md).
- Profile and open-mic updates use `PATCH` with a genuinely partial request body, not `PUT` with a full-replacement body.
- `Handle.status` and `Availability.reason` use the six-state model from [6-open-mic-vanity-urls.md](6-open-mic-vanity-urls.md): `current`, `redirect`, `quarantined`, `reserved`, `available`, `tombstoned`.
- The public vanity resolver (`GET /@:handle`) is intentionally outside `openapi.yaml`; it is served by Fastify directly, outside the `/api` base.
