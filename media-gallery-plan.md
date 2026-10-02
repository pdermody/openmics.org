# Plan: Media Gallery Implementation

Implement `media-gallery-design.md` across API, web, and infra. Execution and deployment happen on other machines. Resource identifiers supplied at deploy time.

**TL;DR.** The design doc's open shape questions have been settled (see "Confirmed decisions" below) and the Phase 0 prerequisite numbers — Plan quotas plus kiosk `media_consent` behavior — are now recorded in [docs/decisions.md](docs/decisions.md). Implementation is ten phases spanning contract → schema → infra → storage adapter → routes → rendition Lambda → server-rendered OG → frontend → tests → verification. Deployment is strictly ordered because the API Docker image bakes in `apps/web/dist/index.html` for OG injection, and the dedicated `media.openmics.org` subdomain requires its ACM SAN to be issued before the MediaStack can bind the certificate.

## Confirmed decisions (from Q&A)

- Prereqs settled first in `docs/decisions.md`; user supplies the numbers.
- Renditions: new SQS queue + Lambda consumer (mirrors email pattern).
- AV scanning: not in Phase 1; drop the flag from the Plan shape.
- Plan: config-only, hard-coded `DEFAULT_PLAN` object. No table, no FK.
- Featured reorder: `PUT /open-mics/{id}/featured-media` with ordered array.
- Download: direct CDN link via `<a download>`; no signed URL, no endpoint.
- OG invalidation on consent revocation: none; API serves event-fallback OG, stale cached HTML expires in 60 min.
- Attribution picker: verified + kiosk only.
- Lightbox pagination: anchor-aware (`?anchor=` returns window + both cursors).
- OpenAPI `Media` schema gap (missing `width`/`height`/`duration_seconds`/`video_platform`/`platform_video_id`) closed in Phase 1.

## Discrepancies flagged (not source-document conflicts, just codebase gaps)

1. `openapi.yaml` `Media` schema missing dimension fields needed by design §5.2 and §13.2.
2. [apps/api/src/spa-routes.ts](apps/api/src/spa-routes.ts) currently returns a hardcoded placeholder HTML, not the real built SPA. Must bake `apps/web/dist/index.html` into the API image for OG injection.
3. CloudFront today only forwards `/api/*` to the ALB; `/media/*` goes to S3. A new `/media/*` behavior on the main distribution is required for OG-stamped SPA responses.
4. No media S3 bucket exists; `openmic-media-{env}` is new. Media bytes are served from a dedicated `media.openmics.org` subdomain backed by its own CloudFront distribution (not from the main site).
5. `Profiles.show_gig_media`, `Registrations.media_consent_updated_at`, and the three new tables don't exist yet.

---

## Phase 0 — Prerequisite decisions

Status: **recorded in [docs/decisions.md](docs/decisions.md)** on 2026-10-01 (media quotas, delivery, kiosk) and 2026-10-02 (capacity caps + reserved conversion fields). Phase 0 is done; implementation may proceed.

The `DEFAULT_PLAN` object has been broadened beyond media (overriding design §8.5's "narrowly scoped" wording). Values the API's `DEFAULT_PLAN` must mirror:

**Media quotas (enforced in Phase 1):**

- Photo MIME allowlist: `image/jpeg`, `image/png`, `image/webp`.
- Max per-file photo size: 10 MB (10,485,760 bytes).
- Per-event photo count cap: 50. Returns `MEDIA_QUOTA_EXCEEDED` with `scope: 'event'`.
- Per-event video count cap: 50. Returns `MEDIA_QUOTA_EXCEEDED` with `scope: 'event'`.
- Global per-account byte backstop: 5 GB (5,368,709,120 bytes). Returns `MEDIA_QUOTA_EXCEEDED` with `scope: 'account'`.
- Presigned PUT URL expiry: 15 minutes.
- AV scanning: disabled; no flag on the Plan shape.
- Rendition variants: `thumb` (400px), `grid` (800px), `lightbox` (2048px), all webp. Fixed; not plan-tunable.

**Capacity caps (enforced in Phase 1):**

- `max_series_per_organizer`: 1 (counts non-soft-deleted; soft-deleted frees the slot). Returns `PLAN_LIMIT_EXCEEDED` with `scope: 'series'`.
- `max_events_per_series`: 50 (counts non-soft-deleted draft + published + past; lifetime cap). Returns `PLAN_LIMIT_EXCEEDED` with `scope: 'event'`.
- `max_event_capacity`: 50 (caps the `capacity` field the organizer can configure; does NOT change the Milestone 2 kiosk-exemption rule). Returns `PLAN_LIMIT_EXCEEDED` with `scope: 'event_capacity'`.

**Reserved conversion-lever fields (shape only, not enforced in Phase 1):**

These exist in the Plan shape so a future Pro plan can gate them with a one-line config change. The gated features themselves don't exist yet; the API ignores these fields.

- `assistants_per_series`: 1
- `custom_branding_enabled`: false
- `custom_domain_enabled`: false
- `analytics_tier`: `'basic'`
- `data_export_enabled`: false
- `bulk_media_download_enabled`: false
- `calendar_invite_attachments_enabled`: false
- `email_sender_customization_enabled`: false
- `sms_reminders_enabled`: false

**Explicitly NOT in the Plan:** per-account comment/like rate limits (anti-abuse, not conversion — belong to a future "Platform rate limits" section), soft-delete window differentiation (conflicts with the uniform 30-day retention decision), per-day event-create limits, expanded MIME types in paid tiers.

**Kiosk `media_consent`** (both organizer-kiosk and kiosk-QR): both forms ask the performer explicitly, toggle **pre-checked TRUE**. Overrides [media-gallery-design.md](media-gallery-design.md) §10.2; design doc should be reconciled to decisions.md in a follow-up edit. API/web implementation follows decisions.md.

**New error code** needed in Phase 1 contract (addendum to Phase 1 below): `PLAN_LIMIT_EXCEEDED` with discriminator `scope: 'series' | 'event' | 'event_capacity'`. This is distinct from `MEDIA_QUOTA_EXCEEDED` (which stays scoped to media).

Also update [FEATURE-PLAN.md](FEATURE-PLAN.md) §6A to reflect: no AV scanning in Phase 1, no CF invalidation, no `/download` endpoint, config-only Plan broadened beyond media.

Run `npm run check:links` after doc edits.

---

## Phase 1 — Contract alignment (OpenAPI)

Edit [openapi.yaml](openapi.yaml):

- Extend `Media` with `width` (int, nullable), `height` (int, nullable), `duration_seconds` (int, nullable), `video_platform` (enum: `youtube` | `vimeo`, nullable), `platform_video_id` (string, nullable), `renditions` object with `thumb` / `grid` / `lightbox` / `original` each having `url`, `width`, `height`, `mime_type`, `size_bytes`. Add `alt_text` field (derived server-side if omitted).
- Extend `MediaCreateRequest` to accept the server-generated `object_key` returned by `/media/upload-url`; drop client-supplied `source_url` from the request (server composes it from the plan-bound bucket).
- Add `MediaListResponse` with `items`, `prev_cursor` (nullable), `next_cursor` (nullable). Replace existing paginated media responses.
- Add `type` (`all` | `photo` | `video`), `sort` (`newest` | `shuffle` | `most_liked`), `seed` (int, optional, for shuffle stability), and `anchor` (media id, optional) query params to `GET /events/{id}/media`, `GET /open-mics/{id}/media`, `GET /profiles/{id}/media`.
- Add `GET /me/media/recently-deleted` (organizer-auth, lists soft-deleted media across the caller's series/events).
- Add `PUT /open-mics/{id}/featured-media` with request body `{ media_ids: string[] }` (ordered, replace semantics). Response is the resulting Featured list.
- Note at file level: `/media/:mediaId` deep-link path is NOT in `openapi.yaml` (same convention as `/@:handle`, served outside `/api`).
- Add error codes: `MEDIA_NOT_FOUND`, `MEDIA_HIDDEN`, `MEDIA_UPLOAD_INVALID`, `MEDIA_QUOTA_EXCEEDED`, `MEDIA_SOURCE_POLICY`, `MEDIA_CONSENT_REVOKED`, `MEDIA_FEATURED_INVALID`, `MEDIA_RECOVERY_EXPIRED`, `PLAN_LIMIT_EXCEEDED` (shared across non-media caps; discriminator `scope: 'series' | 'event' | 'event_capacity'`).
- Keep `/media/{id}/recover`, `PATCH /media/{id}`, `POST /media/upload-url` as they are, but align response shapes with the new `Media` schema.
- Deliberately NOT added: no `GET /media/{id}/download` (direct CDN link used), no admin endpoints, no CloudFront invalidation endpoint.

Validate:
- `npm run validate:openapi`
- `npm run lint:openapi`
- `npm run coverage:openapi` continues to pass once routes land

---

## Phase 2 — Database schema (new migrations)

Under [apps/api/migrations/](apps/api/migrations/). Numbers follow `018_kiosk_qr_registrations.cjs`.

- `019_media_tables.cjs`
  - `Media` table matching the Post-MVP appendix in [docs/architecture/data-model.md](docs/architecture/data-model.md) with the extra columns from Phase 1 (`width`, `height`, `duration_seconds`, `video_platform`, `platform_video_id`, `alt_text`, `renditions jsonb`), plus denormalized attribution snapshot columns `performer_name_snapshot`, `performer_city_snapshot` (nullable, captured on insert when `registration_id` set).
  - CHECK: either `event_id` set XOR `open_mic_id` set.
  - CHECK: `registration_id` not set when `open_mic_id` set and `event_id` null (series-scope media is always free-standing).
  - CHECK: `media_type='video' → source_url present AND video_platform IN ('youtube','vimeo')`; `media_type='photo' → source_url present` (host validated in app layer).
  - Indices: `(event_id, created_at DESC, id)` partial WHERE `deleted_at IS NULL`; `(open_mic_id, created_at DESC, id)`; `(registration_id)`; `(deleted_at)`; `(deletion_reason)`.
  - `PendingS3Deletions` table and `OpenMicFeaturedMedia(open_mic_id, media_id, position)` with UNIQUE on `(open_mic_id, media_id)` and `(open_mic_id, position)`; FK to `Media` with ON DELETE cascade.
- `020_registration_media_consent_updated_at.cjs` — add `media_consent_updated_at timestamptz NULL`. Backfill from `Registrations.updated_at` where `media_consent IS NOT NULL`.
- `021_profile_show_gig_media.cjs` — add `show_gig_media boolean NOT NULL DEFAULT TRUE` to `Profiles`.

Promote the Media / PendingS3Deletions / OpenMicFeaturedMedia schema sections from the Post-MVP appendix of [docs/architecture/data-model.md](docs/architecture/data-model.md) back into the Phase 1 schema section as part of this slice (per FEATURE-PLAN §6A step 1).

Verify by running against the testcontainers suite: `npm run test:integration`.

---

## Phase 3 — Infra (CDK) scaffolding

Convention: each bounded concern = one stack class under [infra/lib/](infra/lib/), wired in [infra/bin/infra.ts](infra/bin/infra.ts). Resource identifiers (bucket name, distribution ID, hosted zone) supplied at deploy time via existing CDK context + env (`OPENMIC_ENVIRONMENT`, `domainName`).

### S3 object layout

Flat per-media-id. The Media row's `id` is the sole key into the object store, so moving media between events is a DB-only operation.

```
tmp/{accountId}/{uuid}.{ext}                       presigned PUT target; 24h lifecycle expiry
original/{mediaId}.{ext}                            committed original (uploader's extension preserved)
renditions/{mediaId}/thumb.webp                     sharp-generated, 400px short side
renditions/{mediaId}/grid.webp                      sharp-generated, 800px short side
renditions/{mediaId}/lightbox.webp                  sharp-generated, 2048px short side
```

- `original/` extension preserved from the uploader (`.jpg`, `.png`, `.webp`) so downloads land with a sensible filename and `Content-Type` stays accurate.
- Renditions are always `.webp`; sharp converts source formats on write.
- Video media stores no S3 objects: thumbnails are hotlinked from the provider CDN (`i.ytimg.com`, `vumbnail.com`) per design §13.2.
- All objects uploaded with `Cache-Control: public, max-age=31536000, immutable` — `mediaId` never changes.
- Lifecycle rules on the bucket: `tmp/` expires after 24h; `original/` and `renditions/` have no TTL (deletes go through the `PendingS3Deletions` worker).

### Dedicated media subdomain

`media.openmics.org` → its own CloudFront distribution → the media S3 bucket (OAC). Not an alias on the main distribution: media domain stays cookie-free (helps CDN hit ratio against S3), gets its own CORS/CSP headers, and the main distribution loses the `/photos/*` concern entirely.

### New stack

- `infra/lib/media-stack.ts` (new) — owns:
  - `s3.Bucket` for media (name pattern `openmic-media-${environmentName}-${account}`): private, `BlockPublicAccess.BLOCK_ALL`, OAC-only reads, CORS allowing `PUT`/`GET` with `Content-Type`/`Content-Disposition` from both the SPA origin (for presigned PUT) and `https://media.openmics.org` (for CF reads), lifecycle rules as above, `RemovalPolicy.RETAIN`.
  - `s3.BucketPolicy` granting CloudFront OAC read.
  - `cloudfront.Distribution` for the media subdomain: `domainNames: ['media.openmics.org']` (`media-${env}.openmics.org` for non-prod envs), origin = media bucket via `S3BucketOrigin.withOriginAccessControl`, cache policy `CACHING_OPTIMIZED`, allowed methods `GET`/`HEAD`, viewer protocol `REDIRECT_TO_HTTPS`. No `errorResponses` SPA fallback (not an SPA).
  - `route53.ARecord` for `media.openmics.org` (and `media-${env}.openmics.org` in non-prod) targeting the distribution.
  - `sqs.Queue` `openmic-media-renditions-${env}` + DLQ (3 retries). Visibility timeout 2 min.
  - `NodejsFunction` `openmic-media-renditions-${env}` (entry `infra/lib/lambda/media-renditions/index.ts`) with sharp bundled via Docker (`forceDockerBundling: true`), 1024 MB memory, 2 min timeout.
  - `NodejsFunction` `openmic-media-purge-${env}` scheduled hourly via EventBridge rule for `PendingS3Deletions` processing. Reads DB (shares the DB secret), deletes S3 objects past `scheduled_for`, marks `processed_at`.
  - Grants: rendition Lambda reads/writes bucket; purge Lambda reads/writes bucket; both read DB secret.
  - Outputs: `MediaBucketName`, `MediaDistributionDomainName`, `MediaCdnBaseUrl` (= `https://media.openmics.org` prod / `https://media-${env}.openmics.org` non-prod), `RenditionsQueueUrl`.

### Updates

- [infra/lib/certificate-stack.ts](infra/lib/certificate-stack.ts): add `media.openmics.org` (and the per-env `media-${env}.openmics.org`) to the ACM certificate's SAN list (us-east-1).
- [infra/lib/api-stack.ts](infra/lib/api-stack.ts):
  - Accept `mediaBucket`, `mediaCdnBaseUrl`, `renditionsQueue` from props.
  - Grant task role `s3:PutObject`, `s3:GetObject`, `s3:DeleteObject` on the bucket's ARN + `/*`.
  - Grant task role `sqs:SendMessage` on the renditions queue.
  - New container env: `MEDIA_BUCKET`, `MEDIA_CDN_BASE_URL` (= `https://media.openmics.org`), `MEDIA_RENDITIONS_QUEUE_URL`, `MEDIA_PRESIGN_EXPIRY_SECONDS`, `MEDIA_RENDITIONS_CALLBACK_SECRET` (from Secrets Manager).
  - Dockerfile update ([apps/api/Dockerfile](apps/api/Dockerfile)): add a build stage that copies `apps/web/dist/index.html` into the API image at `/app/public/index.html`. API reads it at startup. This adds a hard build-order dependency — the API image CANNOT be built before the web app.
- [infra/lib/frontend-stack.ts](infra/lib/frontend-stack.ts):
  - Add additional behavior `/media/*` → `LoadBalancerV2Origin(apiLoadBalancer)` with custom cache policy (`s-maxage=3600`, `max-age=0`), `OriginRequestPolicy.ALL_VIEWER_EXCEPT_HOST_HEADER`. Allows `GET`/`HEAD` only.
  - Do NOT add a `/photos/*` behavior — media is served from `media.openmics.org`, not from the main distribution.
- [infra/bin/infra.ts](infra/bin/infra.ts): instantiate `MediaStack` after `NetworkStack` + `DatabaseStack` + `CertificateStack`, before `ApiStack`. Pass `mediaBucket`, `mediaCdnBaseUrl`, and `renditionsQueue` to `ApiStack`.

Validate: `cd infra && npm run build && npm run synth`.

---

## Phase 4 — API: storage adapter, source policy, Plan config

Create under `apps/api/src/media/`:

- `plan.ts` — hard-coded `DEFAULT_PLAN` object (MIME allowlist, byte cap, quotas, presign expiry). Numeric values driven by env for prod, test defaults in code. Exported helpers: `assertMimeAllowed(mime)`, `assertSizeAllowed(bytes)`, `assertQuotaNotExceeded(…)`.
- `storage/types.ts` — `MediaStorageAdapter` interface: `createPresignedUploadUrl({ ownerAccountId, scope, mimeType, size, filename })` → `{ uploadUrl, objectKey, expiresAt }`; `publicUrl(objectKey)`; `publicRenditionUrl(objectKey, variant)`; `enqueueDeletion(objectKey, reason, scheduledFor)`.
- `storage/s3-adapter.ts` — AWS SDK v3 S3 presigned PUT, with server-generated object keys using the pattern `tmp/{ownerAccountId}/{uuid}.{ext}` (never client-supplied); commit step renames into `original/{mediaId}.{ext}` via `CopyObject` + `DeleteObject`.
- `storage/local-fake.ts` — in-memory + `/tmp` filesystem for unit/API tests.
- `renditions/queue-adapter.ts` — `RenditionsQueueAdapter` interface with `enqueue({ mediaId, objectKey })`; SQS impl + local fake.
- `source-policy.ts` — `validatePhotoSourceKey(objectKey)` (must be under `original/` in the configured bucket); `validateVideoUrl(url)` → `{ platform, platformVideoId }` for `youtube.com`/`youtu.be`/`vimeo.com` with URL parsing; reject anything else.
- `captions.ts` — token substitution with i18n select/plural fallback for missing values; shared between server (OG + alt text) and client (preview).

Unit tests cover each.

---

## Phase 5 — API: media routes

Create `apps/api/src/media/routes.ts` and `apps/api/src/media/repository.ts`. Register under `/api` in [apps/api/src/app.ts](apps/api/src/app.ts) after existing routes, before `spaRoutes`.

Routes (owner-auth unless stated):

- `POST /api/media/upload-url` — reserves an upload slot. Enforces plan MIME/size/quota checks. Returns `{ upload_url, object_key, expires_at }`.
- `POST /api/media` — commit. Verifies the object exists at the given `object_key`, moves it to canonical location, writes `Media` row, snapshots `performer_name_snapshot`/`performer_city_snapshot` from the linked registration if present, enqueues renditions job. Enforces source policy. Rejects if the linked registration has `media_consent = false`.
- `GET /api/media/{id}` — public read. Returns 404 (as "hidden") when `deleted_at IS NOT NULL`.
- `PATCH /api/media/{id}` — owner edits `caption`, `registration_id` (re-snapshot). Rejects changing `media_type` or `source_url`.
- `DELETE /api/media/{id}` — soft-delete. Sets `deleted_at`, `deleted_by_profile_id`, `recovery_deadline = now() + 30d`, `deletion_reason = 'organizer'`. Enqueues `PendingS3Deletions` row with `scheduled_for = recovery_deadline`.
- `POST /api/media/{id}/recover` — restores if `recovery_deadline > now()`. Clears columns; cancels pending S3 deletion.
- `GET /api/events/{id}/media` — public. Query: `type`, `sort`, `seed`, `anchor`, `cursor`, `limit=24`. When `anchor` is supplied, service returns a window centered on the anchor with both `prev_cursor` and `next_cursor`. Serializes only visibility-safe fields; respects event publish state.
- `GET /api/open-mics/{id}/media` — public. Union of free-standing series media + published-event media. Same query shape.
- `GET /api/profiles/{id}/media` — public. Honors `Profiles.show_gig_media` (returns empty page when off); for public callers, respects event/series visibility.
- `GET /api/me/media/recently-deleted` — authenticated organizer. Groups by owning series/event. Pagination via cursor.
- `PUT /api/open-mics/{id}/featured-media` — body `{ media_ids: string[] }`. Replaces the join table rows atomically; rejects pins to hidden/soft-deleted/consent-revoked media. Keeps order via `position = index`.

Cross-cutting integrations:

- **Consent revocation hook.** In `apps/api/src/registrations/service.ts` (or wherever `PATCH /registrations/{id}` writes `media_consent`), when the flag flips `true→false`:
  - Set `media_consent_updated_at = now()`.
  - Soft-delete all `Media` rows with that `registration_id`, setting `deletion_reason = 'consent_revocation'`, `recovery_deadline = now() + 30d`.
  - Enqueue `PendingS3Deletions` for each.
  - Remove any Featured pins pointing at those media.
- **Consent restoration hook.** `false→true` within the 30-day window: restore only rows with `deletion_reason = 'consent_revocation'`, `recovery_deadline > now()`. Rows with `deletion_reason = 'organizer'` stay deleted. Cancel the pending S3 deletions.
- **Attribution picker scope.** `GET /api/events/{id}/registrations` returns all provenances; the web picker filters client-side to verified + kiosk. API returns full list but marks each row with its provenance.
- **Draft-event media.** Use the existing event-publication filter in the service layer; no separate media visibility state.
- **Capacity-cap enforcement outside the media domain.** The Plan's series/event/event-capacity caps are enforced where the resource is created or edited, not in the media routes:
  - `apps/api/src/open-mics/service.ts` on `POST /open-mics` — count non-soft-deleted series owned by the active organizer profile; reject when `>= DEFAULT_PLAN.max_series_per_organizer` with `PLAN_LIMIT_EXCEEDED` + `scope: 'series'`.
  - `apps/api/src/events/service.ts` on `POST /open-mics/{id}/events` — count non-soft-deleted events (any lifecycle state) in the series; reject when `>= DEFAULT_PLAN.max_events_per_series` with `PLAN_LIMIT_EXCEEDED` + `scope: 'event'`.
  - `apps/api/src/events/service.ts` on `POST /events` and `PATCH /events/{id}` — if the incoming `capacity` is null or exceeds `DEFAULT_PLAN.max_event_capacity`, reject with `PLAN_LIMIT_EXCEEDED` + `scope: 'event_capacity'`. Does NOT alter the existing Milestone 2 kiosk-exempt-from-capacity behavior at registration time.

Error envelope follows the existing `errors.ts` shape.

---

## Phase 6 — Rendition Lambda consumer

`infra/lib/lambda/media-renditions/index.ts`:

- SQS event handler. For each record, download `original/{mediaId}.{ext}` from the media bucket.
- Generate variants with `sharp`: `thumb` (max 400px short side), `grid` (max 800px), `lightbox` (max 2048px). Preserve aspect ratio. All renditions are written as WebP regardless of source format (JPEG / PNG / WebP are the only accepted inputs per [docs/decisions.md](docs/decisions.md) → "Media quotas").
- Upload each to `renditions/{mediaId}/{variant}.{ext}`.
- Call back into the API via internal `POST /api/internal/media/{id}/renditions-complete` with signed shared secret (`MEDIA_RENDITIONS_CALLBACK_SECRET`), passing the renditions metadata. API persists `renditions` jsonb and `width`/`height` on the row.
- On failure, SQS retries up to 3 times then DLQs. Media row keeps `renditions = null`; frontend falls back to the original URL via `srcset`.

Local fake for tests: synchronous processing or `fs`-based.

---

## Phase 7 — Server-rendered OG injection on `/media/:mediaId`

Edit [apps/api/src/spa-routes.ts](apps/api/src/spa-routes.ts):

- Read `apps/web/dist/index.html` from `/app/public/index.html` at startup (baked in by Dockerfile). Fall back to the current placeholder in dev.
- Add handler `GET /media/:mediaId` (registered BEFORE the catch-all) that:
  - Loads media by id.
  - If visible, injects into `<head>`: `og:title` = substituted caption (reuses `captions.ts`), `og:description` = `{event_name} · {event_date}`, `og:image` = lightbox-rendition URL (or video thumbnail), `og:url` = canonical, `og:site_name`, `twitter:card = summary_large_image`, mirrored twitter tags. No `og:video`.
  - If missing/hidden/soft-deleted, falls back to the owning event's OG (title = event name, URL = event canonical, **`og:image` omitted** — no event cover column exists today; social cards render without a hero image). Returns 200 HTML.
  - If the media is series-scope and free-standing, falls back to the series OG on the same terms (title = series name, URL = series canonical, `og:image` omitted — no series cover column exists today either).
  - Sets `Cache-Control: public, s-maxage=3600, max-age=0`.

OG tag injection is a string-template substitution in `<head>` (reuse an existing `html-escape` util or add one). Keep it dependency-free.

Unit tests cover: injection for visible media, fallback for hidden media, fallback for missing media, caption substitution.

---

## Phase 8 — Frontend (web)

### 8.1 Routes & state

- [apps/web/src/App.tsx](apps/web/src/App.tsx) (TanStack Router): add `/media/:mediaId` route. On mount, fetch media + its owning event/series, redirect browser URL to `/events/{slug}/{eventCode}?media={mediaId}` (or series equivalent) so the lightbox opens on top of the natural context. If owning context fails, render a bare lightbox page with the item centered.
- `apps/web/src/features/media.ts` — TanStack Query hooks: `useEventMedia(eventId, {type, sort, seed, anchor})`, `useOpenMicMedia(openMicId, …)`, `useProfileMedia(profileId, …)`, `useMediaItem(mediaId)`, `useUploadMedia`, `useUpdateMedia`, `useSoftDeleteMedia`, `useRecoverMedia`, `useFeaturedMediaMutation`.

### 8.2 Shared components

- `apps/web/src/components/media/MediaGallery.tsx`
  - CSS masonry via `columns: auto` driven by `--min-tile: 240px`.
  - Type filter chip (All / Photos / Videos), persisted in URL + `localStorage` per design §11.1. Hidden on profile page.
  - Sort control (Newest, Shuffle; Most liked hidden). Shuffle seed in `history.state`, re-shuffle on refresh.
  - Hybrid infinite scroll (2 auto-pages) → explicit "Load more". Keyset cursors.
  - Scroll offset in `history.state`; restored on lightbox close.
  - Skeleton grid using intrinsic aspect-ratio from API data. `prefers-reduced-motion` disables shimmer.
  - Tile hover effect per §5.3 (hover scale 1.05, image scale 1.08, caption slide-up). Static caption on touch.
  - Error states per §5.5.
- `apps/web/src/components/media/Lightbox.tsx`
  - Portal, focus trap (reuse Radix Dialog), ARIA labels per §6.6.
  - Prev/Next walk the anchor-aware cursor API — on open, prefetches ±1 page around the active item.
  - Zoom (wheel, pinch, double-tap).
  - Video: lazy-mounted iframe (`youtube-nocookie.com` with `?enablejsapi=0&rel=0&autoplay=1&mute=1` for YouTube; `vimeo.com/.../embed?dnt=1&autoplay=1&muted=1` for Vimeo). Unmount on Prev/Next/close.
  - Share: `navigator.share` fallback to clipboard copy + toast.
  - Download: `<a>` with `download` attribute, `href` = original rendition URL. No signed URL.
  - Reactions / Comments icons visually present but `disabled`, matching the existing disabled-state pattern on event + open-mic pages.
  - Organizer-only toolbar when `useOrganizerProfile().owns(mediaItem)` returns true.
- `apps/web/src/components/media/FeaturedStrip.tsx` — horizontal scroll on mobile, two-row grid on desktop. Hidden when a filter is active (§11.4).
- `apps/web/src/components/media/CaptionEditor.tsx` — token helper + live preview, 500-char hard cap, warning at 450. Used both inline and in lightbox detail.

### 8.3 Public pages

- `apps/web/src/views/EventPage.tsx` — mount `MediaGallery` scoped to `event.id`. Section hidden when gallery empty.
- `apps/web/src/views/OpenMicPage.tsx` — `FeaturedStrip` above, `MediaGallery` below.
- `apps/web/src/views/ProfilePage.tsx` — "Gallery" section below existing content, respects `show_gig_media`.

### 8.4 Organizer manage pages

- `apps/web/src/views/EventMediaManagePage.tsx` — new, route `/dashboard/series/{seriesId}/events/{eventId}/media`.
- `apps/web/src/views/SeriesMediaManagePage.tsx` — new, route `/dashboard/series/{seriesId}/media`. Includes Featured strip editor with drag-and-drop (keyboard up/down fallback).
- Both pages: drag-and-drop upload zone (reuse / introduce a shared `MediaUploader` component), batch "Attribute all to…" picker, per-row attribution dropdown (verified + kiosk registrations only), per-tile actions, bulk-select mode, "Preview as public visitor" toggle, "Recently deleted" tab.
- Upload flow: `POST /media/upload-url` → direct `PUT` to presigned S3 URL with `Content-Type` → `POST /media` to commit. Per-file progress, cancel per-file, Cancel all. On cancel, API-side object cleanup is handled by lifecycle rule on `tmp/` prefix + `PendingS3Deletions` for committed-but-cancelled.

### 8.5 Profile settings

- `apps/web/src/views/ProfileEditPage.tsx` (existing): add "Show my gig photos on my profile" toggle wired to `PATCH /profiles/{id}` `show_gig_media` field.

### 8.6 i18n

- Add namespaced keys to `apps/web/src/locales/en/common.ts` (and `es/common.ts`):
  - Caption defaults with `withCity`/`noCity` plural-select variants (short + long form).
  - Gallery UI copy, error states, toasts.
  - Lightbox a11y labels.
- Run `apps/web/scripts/check-untranslated-ui.mjs` after.

### 8.7 Share control reuse

- Reuse the referral-share control planned in FEATURE-PLAN §C4 (Web Share + copy fallback). If that control hasn't shipped yet, build a minimal share util here and refactor later.

---

## Phase 9 — Tests

- **API unit** (`apps/api/tests/unit`): plan guards, source-policy, caption substitution, consent revocation state transitions, cursor encoding.
- **API HTTP** (`apps/api/tests/api`): auth matrix on every route; OpenAPI operation coverage; serialization hides consent-revoked, soft-deleted, draft-event, and `show_gig_media=false` rows; owner cannot pin someone else's media; attribution to a `media_consent=false` registration is rejected; recovery of consent restores only `deletion_reason='consent_revocation'` rows.
- **API integration** (`apps/api/tests/integration`): migration pack applies cleanly; soft-delete + recover; anchor-aware pagination gives a window around the anchor; Featured join table unique constraints hold under concurrent reorders.
- **Storage adapter**: local fake-based tests for the API; no real AWS.
- **Rendition Lambda**: Vitest with `sharp` + a 1×1 fixture; local fake queue.
- **Web unit** (`vitest`): MediaGallery renders tiles with correct aspect-ratio placeholders; Lightbox keyboard navigation; CaptionEditor preview matches server substitution; share fallback.
- **Playwright** (`apps/web/e2e`): happy-path upload, deep-link open on `/media/:id`, consent-revocation hide, soft-delete + recover.
- **Server-rendered OG**: API-level test asserts OG tags are stamped into `/media/:id` HTML; falls back to event OG when the media is hidden.

---

## Phase 10 — Verification (run before PR)

From repo root:

1. `npm run typecheck:api`
2. `npm run validate:openapi`
3. `npm run lint:openapi`
4. `npm run coverage:openapi` — every new operation must be covered by API tests
5. `npm run test` — API unit + API HTTP + API integration + web
6. `npm run check:links`
7. `cd apps/web && npm run build` (also required because the dist artifacts feed into Phase 3 Dockerfile)
8. `cd infra && npm run build && npm run synth`

---

## Deployment steps (CDK, run from another machine)

Prerequisites supplied at deploy time:

- `OPENMIC_ENVIRONMENT` = `dev` | `staging` | `prod`
- `domainName` (via CDK context or `OPENMIC_SES_DOMAIN`)
- `CDK_DEFAULT_ACCOUNT` / `CDK_DEFAULT_REGION`
- `docs/decisions.md` numeric values populated

Build order matters because the API image COPYs the built web `index.html`:

1. `cd apps/web && npm ci && npm run build` — produces `apps/web/dist/index.html` consumed by both `FrontendStack` (S3 deployment) and the API Dockerfile (OG injection template).
2. `cd infra && npm ci && npm run build && npm run synth` — validates the synthesized template.
3. `npm run diff -- OpenMicCertificateStack-$OPENMIC_ENVIRONMENT OpenMicMediaStack-$OPENMIC_ENVIRONMENT OpenMicApiStack-$OPENMIC_ENVIRONMENT OpenMicFrontendStack-$OPENMIC_ENVIRONMENT OpenMicMigrationStack-$OPENMIC_ENVIRONMENT` — review intended changes.
4. **Deploy order** (confirm with user before each `deploy`):
   1. `cdk deploy OpenMicCertificateStack-$OPENMIC_ENVIRONMENT` — adds `media.openmics.org` to the ACM cert SAN list (us-east-1). ACM may require re-validation of the new SAN via DNS; the stack re-uses the existing hosted zone.
   2. `cdk deploy OpenMicMediaStack-$OPENMIC_ENVIRONMENT` — new S3 bucket, dedicated `media.openmics.org` CloudFront distribution + Route 53 alias, rendition queue + Lambda, purge Lambda.
   3. `cdk deploy OpenMicApiStack-$OPENMIC_ENVIRONMENT` — new image including `apps/web/dist/index.html` baked in, new env (`MEDIA_BUCKET`, `MEDIA_CDN_BASE_URL=https://media.openmics.org`, `MEDIA_RENDITIONS_QUEUE_URL`, `MEDIA_PRESIGN_EXPIRY_SECONDS`, `MEDIA_RENDITIONS_CALLBACK_SECRET`), new IAM for S3 + SQS.
   4. `cdk deploy OpenMicMigrationStack-$OPENMIC_ENVIRONMENT` and run the one-off task (per existing migration workflow) to apply migrations 019, 020, 021.
   5. `cdk deploy OpenMicFrontendStack-$OPENMIC_ENVIRONMENT` — new `/media/*` CloudFront behavior → ALB on the main distribution. CloudFront distribution update propagates for ~15 min globally.
5. Smoke tests after each deploy (ask operator before destructive action):
   - After MediaStack: `aws s3 ls s3://openmic-media-$env-...` succeeds; SQS queue exists; `dig media.openmics.org` resolves to the new CloudFront distribution; `curl -I https://media.openmics.org/` returns a `403` (empty bucket root, OAC working).
   - After ApiStack: `curl -I https://$domain/health` 200; `curl -I https://$domain/media/00000000-0000-0000-0000-000000000000` returns 200 HTML with fallback OG tags.
   - After MigrationStack run: `psql ... -c "\dt"` lists new tables; `SELECT COUNT(*) FROM media` succeeds.
   - After FrontendStack: `curl -I https://$domain/media/{real-id}` returns the server-rendered HTML (not the SPA bucket fallback); `curl -I https://media.openmics.org/renditions/{mediaId}/grid.webp` serves image bytes.
6. CloudFront cache: no manual invalidation needed. `BucketDeployment` already invalidates `/*` on FrontendStack deploys.

### Rollback notes

- `MediaStack`: `cdk destroy OpenMicMediaStack-...` is destructive (will try to delete the bucket). The media bucket is `RemovalPolicy.RETAIN` from day one to avoid data loss. Document that the bucket survives stack destroy.
- `ApiStack`: a bad image can be rolled back via `aws ecs update-service --task-definition <previous-revision>`.
- `MigrationStack`: migrations are forward-only (`node-pg-migrate` down-migrations not relied on). Any rollback needs a new reverse migration shipped in a follow-up slice.
- `FrontendStack`: removing the `/media/*` behavior reverts media deep-link URLs to the S3 fallback (serves blank SPA). Acceptable fallback.

### Secrets / IDs provided at deploy time

- `MEDIA_RENDITIONS_CALLBACK_SECRET` — generated by CDK (Secrets Manager) at MediaStack create.
- Media bucket name, CDN base URL, queue URLs — all CDK outputs, consumed via stack props, not hard-coded.

---

## Scope boundaries

**In scope (Phase 1):**
- All design-doc behavior except items explicitly listed under §16.
- Config-only Plan with the numbers supplied by user in Phase 0.
- Server-stamped OG for `/media/:id`.
- Anchor-aware cursor pagination for the lightbox.

**Out of scope (deferred to later slices):**
- Reactions, comments, "Most liked" sort (UI only reserves the slot).
- Per-event / per-performer filter picker on public galleries.
- Paste-from-clipboard uploads.
- Embed-code copy for videos.
- On-the-fly image resizing (ships with pre-generated renditions).
- Video providers beyond YouTube/Vimeo.
- Plan concept beyond media quotas (no DB table, no `account.plan_id`).
- AV scanning (dropped from Plan shape).
- CloudFront invalidation on consent revocation.
- Download endpoint (direct CDN link used).
- Per-item takedown for free-standing media showing a consent-revoked person.
- Multi-tenant branding.
- Custom fullscreen video controls.

---

## Steps summary (scannable)

**Phase 0 — Decisions:** docs/decisions.md (kiosk defaults, Plan numbers), FEATURE-PLAN.md edit.

**Phase 1 — Contract:** openapi.yaml schema + endpoint diffs; validate + lint.

**Phase 2 — Schema:** migrations 019, 020, 021; promote data-model.md sections.

**Phase 3 — Infra:** new `MediaStack`; update `ApiStack` (IAM + env + Dockerfile), `FrontendStack` (new behaviors), `bin/infra.ts` wiring. Validate `cdk synth`.

**Phase 4 — API libs:** `apps/api/src/media/` plan, storage adapter, renditions queue adapter, source policy, captions. *Parallel with Phase 5 route scaffolding.*

**Phase 5 — API routes:** media CRUD, listing, featured, recently-deleted; consent revocation hook in registrations service. *Depends on Phase 2 + 4.*

**Phase 6 — Lambda:** `media-renditions` function + internal callback. *Depends on Phase 3 infra scaffold + Phase 4 adapter.*

**Phase 7 — SPA routes:** `spa-routes.ts` reads real `index.html` + stamps OG for `/media/:id`. *Depends on Phase 5 (needs media reads) + Phase 3 (Dockerfile bake).*

**Phase 8 — Web:** gallery, lightbox, organizer manage pages, profile toggle, i18n. Steps parallelizable: 8.1/8.2 → 8.3/8.4 in parallel → 8.5/8.6.

**Phase 9 — Tests:** unit + API + integration + Playwright.

**Phase 10 — Verification:** typecheck, OpenAPI, test, synth, check-links.

**Deployment:** build web → build infra → synth → diff → deploy MediaStack → ApiStack → run MigrationStack task → FrontendStack → smoke.
