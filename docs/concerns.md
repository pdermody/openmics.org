# Open Mic Documentation Review: Concerns and Gaps

**Status:** Reviewed against [decisions.md](decisions.md) during [IMPLEMENTATION-PLAN.md](../IMPLEMENTATION-PLAN.md) Milestone 0, item 4. Resolved items are recorded below with a pointer to the authoritative source and removed from the active concern list. Only genuinely open items remain in full.

This document originally captured concerns from an early review of the Open Mic planning documents, before [decisions.md](decisions.md), [3-open-mic-requirements.md](3-open-mic-requirements.md), [6-open-mic-vanity-urls.md](6-open-mic-vanity-urls.md), and the `docs/architecture/*` documents reached their current state. Most of the original contradictions have since been settled; this revision keeps the historical record short and points each resolved item at where it was actually decided, rather than re-describing settled ground.

---

## Resolved since the original review

- **MVP scope contradictions (reviews in/out of scope).** Settled: reviews, comments, reactions, private messaging, follows, and multi-admin roles are removed from the Phase 1 contract entirely (see [decisions.md → Delivery order](decisions.md#delivery-order) and [architecture/api-design.md → Deferred](architecture/api-design.md#deferred-later-phase-api-surface)). There is no lingering contradiction because these features aren't in Phase 1 to contradict.
- **Architecture assumptions.** Settled: the API runs on ECS Fargate and infrastructure is provisioned with CDK (see [decisions.md → Infrastructure](decisions.md#infrastructure)). The older infrastructure narrative remains scheduled for rewrite under the canonical implementation plan.
- **Vanity URL design not reflected in architecture/API.** Settled: the handle system (global namespace, casing rules, redirect/quarantine/reclaim lifecycle) is now represented in `docs/architecture/data-model.md` and implemented in the API (`apps/api/src/handles/`); see [decisions.md → Handles](decisions.md#handles).
- **Guest registration lifecycle under-formalized** (duplicate handling, claim conflicts/precedence, race conditions). Settled: see [decisions.md → Guest Registrations](decisions.md#guest-registrations) for the duplicate-contact-email rule, atomic first-writer-wins claim with explicit `409`, rate limiting, and media-consent audit trail.
- **Retention/soft-delete periods undefined.** Settled: one uniform 30-day recoverable window across profiles, open-mics, events, registrations, and media, then hard delete (see [decisions.md → Retention](decisions.md#retention)).
- **Consent capture/revocation/audit undefined.** Settled: default-yes consent, future-only revocation (not retroactive against already-published media), and `media_consent_updated_at` as the audit trail (see [decisions.md → Guest Registrations](decisions.md#guest-registrations) and [decisions.md → Media](decisions.md#media)).
- **Media source validation undefined.** Settled: photos must be objects in the platform's own S3 bucket via the upload-url flow; videos must link to an allowlisted host (`youtube.com`, `youtu.be`, `vimeo.com`) — arbitrary hosts are rejected (see [decisions.md → Media](decisions.md#media)). Upload size limits, MIME validation, and malware scanning remain open — see below (Media is Milestone 5 and not yet built).
- **`PUT` vs `PATCH` inconsistency across the contract.** Settled as part of Milestone 0: profile, open-mic, event, registration, and account updates all use `PATCH` with a partial body (see [decisions.md → API Contract](decisions.md#api-contract) and [decisions.md → Milestone 0 contract reconciliation](decisions.md#milestone-0-contract-reconciliation)).
- **`/auth/*` JSON endpoints vs. Cognito/Amplify.** Settled: `/auth/sign-up`, `/auth/sign-in`, `/auth/refresh-token` are removed from `openapi.yaml`; the browser talks to Cognito directly through Amplify (see [decisions.md → Milestone 0 contract reconciliation](decisions.md#milestone-0-contract-reconciliation)).
- **No defined live-update contract.** Settled: a narrowly scoped organizer event-roster SSE stream is now defined (auth, event names, ordering/resume, heartbeat, multi-instance fan-out) — see [decisions.md → Live updates](decisions.md#live-updates). Not yet implemented; that remains Milestone 2 work.

## Still open for Phase 1

These are genuinely unresolved and should be addressed in the milestone noted, not silently assumed:

- **MVP/near-term/long-term scale targets are still not stated in one place.** No document currently gives a concrete near-term growth target or an explicit trigger for when the Fargate/RDS baseline needs to change. Low urgency until real usage data exists, but should be written down before infrastructure scaling decisions are made under pressure.
- **Security/privacy depth for content that is in Phase 1** (profile bio/text fields, organizer notes, registration free-text fields): sanitization rules against stored XSS, and general abuse/rate-limit coverage beyond the guest-registration limiter already decided, are not fully specified. Should be resolved no later than Milestone 1 (auth hardening) since it's part of the same trust boundary.
- **Media pipeline operational controls** (upload MIME/type validation, file-size limits, malware/virus scanning, presigned URL expiry/rotation policy): the *source* validation rule is decided (see above), but these operational controls are not. Deferred to Milestone 5 (media), since media isn't implemented yet — but must be resolved before Milestone 5 ships, not discovered mid-implementation.
- **Access-control detail for overlapping profile ownership**: how the API behaves when one account owns multiple profiles that could plausibly both touch the same record (e.g., an account that is both an organizer and a performer registering for their own event). The permission model exists at the profile level, but this specific cross-profile-same-account interaction isn't explicitly called out anywhere. Worth a short explicit note in `architecture/data-model.md` before Milestone 2/3 roster and claim work leans on it further.
- **Reviews, comments, reactions, private messaging, and multi-admin moderation policy**: these remain out of the Phase 1 contract entirely (confirmed above), so the original moderation-policy concerns (escalation paths, reporting flows, retention for removed content) are moot for now. They should be revisited as a fresh design pass if/when any of these features are scheduled for a later phase — not resurrected piecemeal.

---

## Areas of good design worth preserving

Unchanged from the original review — still true and still guiding delivery order:

- Organizer-first MVP sequencing.
- Focus on registrations-per-event as the product KPI.
- Non-technical UX defaults.
- Concise separation of organizer and performer responsibilities.
- Strong concept of a public, handle-based URL system.
- Media ownership and organizer/performer separation in the requirements.
- Use of soft-delete/recovery concepts for content recovery.
