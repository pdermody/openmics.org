# Media Gallery — Design Specification

**Status:** Draft
**Date:** 2026-10-02 (reconciled with `docs/decisions.md`)
**Scope:** Public media galleries on event, open-mic (series), and performer-profile pages; the organizer surfaces that produce that media. Photos hosted on the platform and video links to allowlisted providers.

This document describes **what** is being built and **how it behaves**, not how it is implemented. It does not prescribe API shapes, schemas, or code. It intentionally records edge-case behaviour and deferred scope so downstream design (technical architecture, API contract, tasks) has a single source of behavioural truth to work from.

---

## 1. Purpose

Give organizers a way to publish photos and videos of their open-mic series and events, presented to the public as an exciting, responsive gallery that credits performers where consent allows. Grow returning-visitor traffic to event pages by making the gallery share-friendly and deep-linkable.

## 2. Personas and goals

- **Organizer.** Publishes and manages photos and video links. Wants attribution to be quick during upload, wants a preview of what the public will see, wants a way to curate the top of the series page.
- **Public visitor.** Browses events, hunts for photos of themselves or friends, shares individual items into WhatsApp / Slack / iMessage / X.
- **Performer with a claimed profile.** Wants a personal gallery on their profile page collecting photos from gigs they've played, and control over whether that gallery is publicly visible on their profile.
- **Guest performer (unclaimed).** Appears attributed on event and series galleries via the values captured on the registration; not linkable to a profile page.

**Non-goals for Phase 1:** reactions, comments, ratings, private messaging, performer-authored uploads, community moderation flows.

## 3. Surfaces

Four surfaces present or produce media:

1. **Event page — public gallery.** Media associated with this event, ordered by the user's chosen sort inside Photos/Videos tabs. Both tabs remain visible with explicit empty states; no event featured strip.
2. **Open-mic (series) page — public gallery.** Union of all media from every publicly-visible event in the series, ordered by the user's chosen sort. Preceded by an organizer-curated **Featured** strip.
3. **Performer profile page — public gallery.** Media that has been attributed to this profile via registration claim + adoption. Rendered as a "Gallery" section below existing profile content. Owner-toggleable.
4. **Organizer manage view.** Not public. Where uploads, edits, attribution changes, Featured pinning, soft-delete, and recovery live. Includes a "Preview as public visitor" toggle that renders the gallery without organizer chrome.

## 4. Media model (conceptual)

### 4.1 Media types

- **Photos.** Uploaded to the platform's own object storage (see §14 delivery). Served from a CDN-fronted origin at a stable public path.
- **Video links.** URLs pointing at an allowlisted provider (§14). Videos are not re-hosted; only the link and provider metadata are stored.

### 4.2 Attribution model

Every media item has an optional link to a single **registration** on an event. That registration is the source of truth for `performer_name` and `performer_city` used in captions and attribution.

- If the linked registration has been **claimed by an account** and that claim adopts a **profile** for public attribution, the *display* of the performer name and handle is taken from the adopted profile. The stored link remains the registration.
- Un-adopting a profile reverts the display to the registration's snapshot values. No "was: @handle" trail.
- If the linked registration is **hard-deleted**, attribution permanently anonymizes and the caption falls back to the free-standing behaviour.
- If the linked registration is **soft-deleted** (30-day recovery), the media stays visible using a denormalized snapshot of `performer_name` and `performer_city` captured at publish time.
- Media with **no** registration link is **free-standing**. Used for crowd shots, venue photos, promo posters, series banners. No attribution line is shown for free-standing media.

Free-standing media exists only on events and series. Profile galleries are derived from event media attributed to registrations that have adopted the profile; media is never uploaded directly to a profile (see §8.1).

### 4.3 Media lifecycle

- **Draft (organizer only, pre-publication of the event).** Media may be uploaded to a draft event for staging. It becomes public exactly when the event publishes; it is hidden again if the event returns to draft.
- **Published.** Visible per the visibility rules in §9.
- **Hidden by consent revocation** (see §10). Removed from all public galleries, the canonical media page, and media-specific OG output; scheduled for soft-delete with a consent-revocation reason so consent restoration can reverse it.
- **Soft-deleted.** Removed from all public galleries. Recoverable within 30 days from the organizer's "Recently deleted" list. Bytes remain in storage.
- **Hard-deleted.** After 30 days without recovery, bytes are purged.

## 5. Public gallery — visual design

### 5.1 Layout

- **Masonry** columns with aspect-preserving tiles. No forced square crop.
- Column count is **driven by a minimum tile width of ~220–260px**, not by fixed breakpoints. Ultrawide displays get more columns automatically; phones collapse to a single column; tablets land in between and always interact touch-first.
- **Order fidelity.** The visual order of tiles always matches the active sort order and the DOM order, reading left-to-right row by row. Keyboard focus and screen readers traverse tiles in the same order the sort control implies. (This rules out pure CSS multi-column masonry, which fills column-major.)
- Photos and videos use the same masonry layout in separate type-specific tabs. Videos carry a play-badge overlay.
- Public galleries use **Photos / Videos** tabs, defaulting to Photos on event and performer pages. Series uses **Events / Photos / Videos**, defaulting to Events. There is no All media tab. Sorting remains within each media collection.
- Featured media is series-only: Events shows a mixed showcase above the tabs; Photos/Videos show matching featured items first in organizer order, without grid duplication, regardless of sort. Featured viewers do not switch tabs and navigate only that featured selection.
- Extreme aspect ratios are capped in the grid to keep columns balanced: portraits render at up to ~9:16 with letterboxing above/below; panoramas render at up to ~16:9 with center-crop. The lightbox always shows the true aspect ratio.
- Video thumbnails are rendered at a fixed 16:9 assumption in the grid.

### 5.2 Layout stability

Every photo tile pre-reserves its rendered space using intrinsic width/height provided by the API, via CSS `aspect-ratio`. Video tiles reserve 16:9 unconditionally. Images loading in below the fold do not cause tiles above them to shift.

### 5.3 Tile hover effect

On pointer devices with hover capability:
- Tile scales to ~1.05×.
- The image inside scales independently to ~1.08× (a subtle in-tile Ken-Burns-style micro-zoom).
- A colored border glow appears.
- The caption slides up from the bottom over a dark gradient.

On touch devices, the caption is always visible with a subtle gradient (no hover needed).

`prefers-reduced-motion: reduce` disables the scale, micro-zoom, and glow. The caption fades in statically instead.

### 5.4 Tile action affordances

The tile itself is the only click target — no per-tile action icons. Actions live in the lightbox. Video tiles show a visual play badge only (not a separate button).

### 5.5 Empty, loading, error states

- **Empty (public view).** Both Photos/Videos tabs remain visible, with an explicit empty message for the selected collection. Profile privacy and gallery opt-out still hide the gallery.
- **Empty (organizer manage view).** Empty-state illustration with a call-to-action to upload or add a video.
- **Loading.** Skeleton grid renders immediately (no center spinner) with shimmer animation. Shimmer respects `prefers-reduced-motion` and drops to static gray tiles when reduced.
- **Whole-gallery load failure.** Friendly panel with translated copy and a Retry button. Rest of the page is unaffected.
- **Individual image failed to load.** Broken-image icon inside the tile with alt text; tile stays interactive so the lightbox opens (which retries). Second failure in the lightbox shows "Image unavailable — Try again."
- **Video provider unreachable / removed video.** Tile shows a generic video placeholder labeled "Video unavailable." Organizer view shows a stronger "This video failed to embed — remove or update the link" hint.

## 6. Lightbox

Opens when a tile is clicked (or a deep-link is followed).

### 6.1 Layout

- Media area fits the viewport with padding. Portraits fit height, panoramas fit width, videos are capped at ~1600px wide even on wider viewports so controls stay reachable.
- The caption and attribution render below the media. Long captions cap at ~4 lines with a "Show more" toggle. Alt text is uncapped.
- Toolbar at top: Close, Share, Download (photos only), and a small **Reactions** and **Comments** icon set that matches the **existing disabled-state pattern used on the open-mic and event pages**. No counters are shown next to the disabled icons.
- Prev / Next arrows on the sides for keyboard/pointer, and left/right swipe on touch. Navigation follows the selected collection: mixed media in the series Events featured showcase, matching media only in Photos/Videos.
- On mobile browsers the lightbox contains overscroll (`overscroll-behavior: contain`) so swipe navigation never triggers pull-to-refresh or browser history gestures.

### 6.2 Zoom

- All zoom lives in the lightbox — no hover magnifier on tiles.
- Scroll-wheel zooms on desktop.
- Pinch zooms on touch.
- Double-tap toggles between fit and 2×.

### 6.3 Video playback

- Provider thumbnail is used as the tile image. Iframes are not loaded until playback starts.
- On open, the lightbox mounts the provider iframe and starts **muted autoplay**. User unmutes via the provider's own controls.
- On close and on Prev/Next, the iframe is unmounted so audio stops immediately. A brief fade covers the swap.
- Fullscreen uses the provider's built-in button (via `allow="fullscreen"`); no custom fullscreen.
- Captions/subtitles come from the provider; not overridden.
- Vertical videos fit height to viewport with black side-bars.
- YouTube embeds use `youtube-nocookie.com`. Vimeo embeds use `dnt=1`.
- Video providers allowed: **YouTube and Vimeo only** (matches the existing `docs/decisions.md` rule). Twitch, TikTok, Instagram Reels are out of Phase 1 scope.

### 6.4 Actions in the lightbox

- **Close.** `Esc`, close button, or click on the backdrop.
- **Share.** Uses the Web Share API where available; otherwise copies the deep-link URL to clipboard and shows a "Link copied" toast.
- **Download.** Photos only. Downloads the original from the CDN with `Content-Disposition: attachment`. Filename pattern: `{series-slug}-{event-date}-{performer-or-media-id}.{ext}`. Videos have no download button; instead a small **Watch on YouTube / Watch on Vimeo** secondary link opens the provider in a new tab.
- **Reactions.** Visually present but disabled, matching the pattern on the open-mic and event pages.
- **Comments.** Visually present but disabled, matching the pattern on the open-mic and event pages.
- **Organizer-only actions** (shown only when the organizer is signed in and owns this media): Edit caption (opens the full editor with token helper and live preview, §7.4), Change performer link, Pin to Featured (series scope), Soft-delete.

### 6.5 Attribution linking

- Performer name links to `/{handle}` when the attribution resolves to a claimed and adopted profile.
- Performer city is always plain text.
- Guest-only attribution shows the name as plain text.
- Free-standing media shows no attribution line at all.

### 6.6 Accessibility

- `Esc` closes the lightbox.
- `←` / `→` navigate. `Home` / `End` jump to the first / last item in the current gallery.
- Focus is trapped inside the lightbox while it is open.
- On close, focus returns to the originating tile and the tile is scrolled into view smoothly.
- All action buttons are keyboard-reachable with visible focus rings.
- Alt text for photos = the substituted caption text. Fallback when no caption resolves: `"Photo from {event_name}"`.
- All motion respects `prefers-reduced-motion`.

## 7. Captions and tokens

### 7.1 Token vocabulary

Captions may include the following single-brace tokens:

- `{performer_name}`
- `{performer_city}`
- `{event_name}`
- `{event_date}`

No `{song_title}` in Phase 1.

Free-standing media has no performer context; `{event_name}` and `{event_date}` may resolve only when the media is scoped to an event. Series-scope free-standing media resolves neither.

### 7.2 Default captions (when the organizer has not written one)

Default captions are translated i18n keys. Two default shapes exist:

- **Short form**, used on the event gallery: performer + city.
- **Long form**, used on the open-mic (series) gallery and as the suggested prefill inside the event caption editor: performer + city + event name + event date.

Free-standing media has no default caption text (empty).

### 7.3 Missing-value fallbacks

- **In default captions.** Use an i18n select/plural pattern with paired keys (e.g. with-city vs no-city) so each language reads naturally. Never render "Unknown" or empty-token markers.
- **In organizer-written captions.** Drop the missing token and trim surrounding whitespace, dashes, or punctuation.

### 7.4 Editing captions

Two edit surfaces, both writing to the same field:

1. **Inline quick-edit** on each tile in the organizer manage view.
2. **Full editor** inside the media detail / lightbox when the organizer is signed in.

Both editors show:

- A live **preview** of the substituted text using this media's actual attribution values.
- A "tokens available" helper listing the valid tokens for this media (fewer for free-standing).

Character limit: **500** characters hard cap, warning shown at 450.

### 7.5 What the preview and defaults show for public visitors

- Tile caption: single line, ellipsized to fit tile width.
- Lightbox caption: full text, capped at ~4 rendered lines with a "Show more" toggle.
- Alt text: full substituted caption, no length cap.

## 8. Organizer upload and manage UX

### 8.1 Where uploads start

- **Media tab** on the event and series page (organizer view).
- **Per-registration shortcut** on the event roster: an "Add media" affordance next to each registration that pre-attributes to that performer and offers both photo upload and video-link entry.
- Media added through a registration shortcut remains event-scoped and links to that registration. Profile galleries are derived from event uploads attributed to registrations that have adopted the profile; neither organizers nor performers upload directly to a profile.

### 8.2 Upload interaction

- Click-to-open file picker and drag-and-drop onto the media area. Multi-file. The file picker is the universal path — on phones and tablets it offers camera capture and the photo library; drag-and-drop is a pointer-device enhancement, never the only path.
- The picker declares the Plan's MIME allowlist via its accept filter. HEIC is not accepted; iOS pickers normally transcode HEIC to JPEG automatically, but files that arrive as HEIC are rejected client-side with a translatable "use JPEG, PNG, or WebP" message rather than failing at the server.
- Per-file progress bar with thumbnail preview.
- Parallel uploads (browser-limited concurrency).
- Each row has a Cancel action, and the batch has **Cancel all**. Cancelling aborts active requests and marks queued files cancelled without affecting files that already completed successfully.
- Objects uploaded to storage but not committed as media records are treated as abandoned uploads: they are enqueued for cleanup and do not consume organizer quotas.
- Per-file retry on failure; other files are unaffected.
- Client-side MIME and size validation mirrors the server rules from the organizer's Plan (§8.5).
- Successful uploads appear immediately in the manage view. Publication to the public gallery follows the event visibility rules.
- Paste-from-clipboard uploads are not in Phase 1 scope.

### 8.3 Attribution during upload (event scope)

- At the top of the batch: a **"Attribute all to…"** picker that pre-fills every upload row with the same performer.
- Each row also has its own attribution dropdown, pre-populated with the batch default and inline-overridable.
- The attribution picker is a searchable dropdown of **this event's registrations only**. Free-standing ("No performer") is always available at the top of the list.
- Series-scope uploads have no attribution picker (always free-standing).

### 8.4 Manage view

- Same masonry layout as the public gallery, with a persistent per-tile action toolbar: **Edit caption**, **Change performer link**, **Pin to Featured** (series scope only), **Soft-delete**. On touch devices the toolbar is always visible with touch-sized targets (≥44px).
- Filter chips: **All / Published / Hidden / Recently deleted** in addition to **Photos / Videos**.
- Sort: **Newest**, **Oldest**, **A–Z by caption**, **By performer**.
- Bulk-select is an explicit selection mode toggled from the toolbar — identical for mouse, keyboard, and touch (no long-press or hover dependency) — with bulk actions: bulk soft-delete, bulk attribution change, bulk add to Featured.
- **+ Add video** button separate from photo upload. Opens a form with a URL input validated against the provider allowlist, an optional caption, an attribution picker, and a live thumbnail preview once a valid URL is entered. Once a valid URL resolves, the caption is prefilled from the provider's public oEmbed title — fetched directly from the browser (no API endpoint; both providers allow cross-origin reads and need no API key). Organizer edits are never overwritten, and the lookup is best-effort — an unreachable provider or unknown video simply leaves the caption empty.
- **Featured strip** (series scope): drag-and-drop reorder for the pins using pointer events so it works with mouse and touch alike, with up/down button fallback for keyboard use. Featured items may be either free-standing series media or specific event media the organizer has hand-picked.
- **Preview mode.** A "Preview as public visitor" toggle that renders the manage view as a public gallery (no toolbars, no organizer chrome, no manage filter chips). Same URL, toggled in place.
- **Recently deleted section.** Everything soft-deleted within the last 30 days. Restore button per item; restore preserves the item's original `created_at` so it re-appears at the correct chronological position. After 30 days without restore, the item hard-deletes and bytes are purged.

### 8.5 Plan concept

Organizer capabilities are governed by a **Plan** entity assigned to the organizer. The Plan carries media quotas, scale caps, and reserved conversion-lever fields. Media-only consumers of the Plan read only the media-related fields.

Media-related fields:

- Allowed MIME types for photos.
- Maximum per-file size for photos.
- Per-event photo count cap.
- Per-event video count cap.
- Global per-account byte backstop.
- Presigned URL expiry window used for uploads.

Scale caps (non-media):

- Maximum series per organizer.
- Maximum events per series.
- Maximum event capacity the organizer may configure.

Reserved conversion-lever fields (shape only in Phase 1; enforced when the underlying feature ships): collaboration assistants per series, custom branding, custom domain, analytics tier, data export, bulk media download, calendar invite attachments, email sender customization, SMS reminders.

Phase 1 ships a **single hard-coded `DEFAULT_PLAN`** object in the API and applies it to every organizer. There is no `Plans` table and no `Accounts.plan_id` column — adding a second plan is a config change plus (then and only then) a migration. The explicit anti-pattern this guards against is standing up full tier infrastructure for a hypothetical paid tier that may never ship as spec'd.

**The numeric values and the exact Plan shape** are not resolved here. They are recorded in [`docs/decisions.md`](decisions.md) under "Organizer `DEFAULT_PLAN` values (Phase 1, config-only)". This spec defines only the behaviour the Plan drives.

**History.** An earlier revision of this spec scoped the Plan "narrowly to media quotas" and declared non-media gating out of scope. That boundary was deliberately relaxed in `docs/decisions.md` on 2026-10-02 so a single Plan surface covers every tier-differentiating lever, including scale caps and conversion-reserve flags. Follow decisions.md as the current authority.

## 9. Public visibility rules

Media inherits the visibility of its scope; that visibility is enforced by the API, not by the frontend.

| Scope state | Gallery visible to public? | Featured strip visible? |
|---|---|---|
| Event: draft | No | — |
| Event: published (future/live/past) | Yes | — |
| Event: soft-deleted (within 30-day recovery) | No | — |
| Event: hard-deleted | Gone permanently | — |
| Series: active | Yes | Yes (if pinned items exist) |
| Series: paused | No (including its events and derived profile media) | No |
| Series: soft-deleted | No | No |
| Series: hard-deleted | Gone permanently | Gone |
| Profile: public + owner toggle on | Yes | — |
| Profile: public + owner toggle off | Hidden on profile only; underlying media unaffected on event/series galleries | — |
| Profile: private / deleted | No | — |

Media uploaded to a draft event is retained but not visible; it becomes public the moment the event publishes and hides again if the event returns to draft.

## 10. Consent and privacy

### 10.1 Registration media consent — retroactive semantics

Revoking `media_consent` on a registration:

- **Hides all media linked to that registration** from every public gallery (event, series, profile, deep-link, OG unfurl).
- **Blocks new uploads** attributed to that registration.
- **Enqueues affected media into the standard 30-day soft-delete window** with a consent-revocation reason so bytes eventually purge from object storage.
- `Registration.media_consent_updated_at` is retained as an audit record. It no longer functions as a "grandfathering boundary"; it just records when the toggle last changed.

If consent is restored during the 30-day window, media soft-deleted solely because of that revocation is restored automatically. Media the organizer independently soft-deleted remains deleted. Once the 30-day window has elapsed and bytes have been purged, restoring consent cannot restore the media.

Revocation removes access through the application but does not invalidate an already-known raw CDN object URL during the recovery window. Consent revocation invalidates the cached media deep-link HTML so media-specific OG output stops immediately; the underlying CDN object is not invalidated.

**Blind spot.** Free-standing media (no registration link) that happens to depict the same person is **not** covered by this filter. A per-item takedown request flow is flagged as follow-on scope and is **not** in Phase 1.

### 10.2 Kiosk defaults for `media_consent`

Both kiosk flows — organizer-kiosk and kiosk-QR self-registration — ask the performer the media consent question explicitly on their own form, with the toggle **pre-checked to TRUE**. One consistent, auditable pattern across both surfaces.

**History.** An earlier revision of this spec split the two: organizer-kiosk defaulted `true` without asking (trusting the organizer to have asked in person), and kiosk-QR asked without an implicit default. That split was reconciled on 2026-10-02 to a single ask-and-default-true pattern recorded in [`docs/decisions.md`](decisions.md) under "Media consent at kiosk." Follow decisions.md as the current authority.

### 10.3 Profile-owner display toggle

The performer profile page carries a per-profile toggle **"Show my gig photos on my profile"**, default **on**. This is a **display control on the profile surface only**. It does **not** hide media from event or series galleries and is **not** a substitute for registration `media_consent`.

### 10.4 Profile lifecycle / un-adoption

If a claimed profile is un-adopted from a registration or the profile is deleted:

- Attribution on affected media reverts to the registration's raw snapshot of `performer_name` and `performer_city`.
- The performer name is no longer a link.
- No "was: @handle" trail is retained on the public display.

## 11. Ordering, filtering, pagination

### 11.1 Sort options

- **Newest** (default) — most recent `created_at` first.
- **Shuffle** — a stable random order for the duration of the session.
- **Most liked** — planned for when reactions ship, **hidden** in the UI until then.

The chosen sort persists in the URL query (`?sort=…`) and in `localStorage`. On page load, the URL query wins and its value is written back to `localStorage`. If neither is present, the `localStorage` value seeds the default.

The **shuffle seed** lives in memory and in `history.state` — **not in the URL**. Refresh reshuffles (a feature, not a bug). Back-button after opening the lightbox restores the same shuffle order because the seed rides with `history.state`.

### 11.2 Filter

- **Media tabs**: Photos / Videos on event and performer-profile galleries; Events / Photos / Videos on series. Both media tabs remain visible when empty.
- No other visible filter picker in Phase 1 (no "by event" or "by performer" picker).
- Deep-link filter query params (`?event=…`, `?performer=…`) are **reserved** for future use so cross-page links won't break URL shapes later.

### 11.3 Pagination

- **Hybrid infinite-scroll then explicit Load-more.** The first two additional pages autoload as the user scrolls. After that, an explicit **Load more** button appears.
- **Keyset ("cursor") pagination.** The API returns an opaque `next_cursor` string that the client sends back to fetch the next page. This is a stateless keyset seek, not a database cursor.
- Page size ~24 items.
- Scroll offset is preserved in `history.state`. On lightbox close, focus and scroll return to the originating tile.
- Loading the next page shows skeleton tiles at the bottom with intrinsic dimensions.
- **End-of-gallery state**: a translatable "You've reached the end" message with a back-to-top link.
- **Page-fetch error state**: an inline "Couldn't load more — Retry" affordance. Existing loaded items stay in place; the error does not take over the page.

### 11.4 Featured strip and filters

- The Featured strip renders in the organizer's manual order regardless of the sort control.
- Events shows a mixed featured showcase above the tabs. Photos/Videos show only matching featured items inside their tab and exclude those pins from the grid.

## 12. Sharing and deep-linking

### 12.1 Deep-link URL shape

Each media item has one stable, shareable canonical deep-link: `/media/{media_id}`. The URL is the same regardless of whether the item was opened from an event, series, or performer-profile gallery.

The media ID lives in the **path**, not in a `#fragment`, so that servers, CDNs, and social scrapers can see it.

Opening a deep-link:

- Loads the media and its owning event or series context.
- Opens the lightbox on the specified item.
- If the media is hidden by consent revocation, soft-deleted, or hard-deleted, the route shows the surrounding event or series page with a translatable toast reading "That photo isn't available anymore," and the lightbox does not open. A server-side metric logs the miss.
- If its parent series is paused or otherwise unavailable publicly, the media and private parent context are not exposed; the route shows an unavailable state instead.

### 12.2 Share action

- The share button in the lightbox uses the **Web Share API** where the browser supports it (`navigator.share`), invoking the OS share sheet.
- Where the Web Share API is unavailable (typical desktop browsers), it **copies the deep-link URL to the clipboard** and shows a "Link copied" toast.
- The shared URL is the media deep-link (§12.1), never the underlying storage URL.

### 12.3 Social unfurl / Open Graph

When a shared deep-link is pasted into Slack, WhatsApp, iMessage, Facebook, X/Twitter, or any other Open-Graph-aware surface, the preview card is populated by server-injected tags:

- `og:title` = the substituted caption for this media (using the same token logic as the on-page caption).
- `og:description` = event context (event name and date).
- `og:image` = the **`lightbox`-rendition** URL for photos, or the provider thumbnail for videos.
- `og:url` = the canonical deep-link.
- `og:site_name` = "Open Mic" (or whatever the site's canonical name resolves to).
- `twitter:card = summary_large_image`, `twitter:title`, `twitter:description`, `twitter:image` mirror the OG values.
- **No `og:video`** — clicks always land back on the site, and the site's own lightbox handles playback. This is deliberate.

### 12.4 Injection mechanism (behavioural)

- The deep-link route serves the SPA's `index.html` **with the OG tags stamped into the `<head>` server-side**. This behaviour extends the existing `apps/api/src/spa-routes.ts` pattern; adding one more route pattern is the entirety of the new server-side surface.
- Response `Cache-Control: public, s-maxage=3600, max-age=0` — the CDN caches the rendered HTML at the edge for **60 minutes**; browsers revalidate on each hit.
- **CDN invalidation on privacy mutations only.** Caption edits and ordinary organizer deletes may take up to 60 minutes to reflect in social unfurl previews. Consent revocation invalidates the canonical media page's cached HTML immediately so media-specific OG tags are no longer served. The raw photo object remains available to anyone who already knows its CDN URL until normal hard deletion.
- **Stale deep-links at scrape time.** If the media is missing or hidden when the scraper hits, the injector **falls back to the surrounding event's OG tags** only when that parent is publicly visible (event name and event URL only; `og:image` is omitted because no event cover column exists in Phase 1). Paused or otherwise non-public parents use generic site tags without their names or media. The response remains a valid `200` HTML page; the scraper never sees a 404.

## 13. Delivery baseline

### 13.1 Photos

- **Origin:** the platform's own object storage bucket (matches the existing `docs/decisions.md` rule that photo `source_url` must reference the platform's own S3 media bucket).
- **Distribution:** a CDN in front of the origin.
- **Renditions:** a small fixed set generated at upload time — `thumb`, `grid`, `lightbox`, `original`.
- **Client selection:** the browser picks the appropriate rendition via `srcset` sized to the actual rendered width of the tile.
- **Download action:** serves the `original` rendition with `Content-Disposition: attachment`. May use a signed URL for that specific action.
- **Public URL shape is stable** across future upgrades to on-the-fly image resizing. On-the-fly transforms are **not** in Phase 1.

### 13.2 Videos

- **Video thumbnails** come from the provider's own CDN (YouTube's `i.ytimg.com`, Vimeo's `vumbnail.com`). No custom thumbnails.
- **Playback** happens inside the provider's iframe when the lightbox opens (§6.3).
- **No re-hosting**, no cached copies, no embed-code copy action.

## 14. Responsive behaviour

- Column count scales from 1 (mobile) through 4–6 (typical desktop) up to whatever a min-column-width of 220–260px permits (ultrawide). Tablets fall naturally between phone and desktop counts; every interaction on them is touch-first and never depends on hover.
- Featured strips are labelled "Featured photos and videos" and use compact horizontally scrollable rails with previous/next controls overlaid on the left/right edges of the carousel on mobile and desktop; no automatic rotation.
- Lightbox occupies the whole viewport on mobile with a slim close button and tap-to-hide toolbar. On desktop it centers with a backdrop.
- Organizer manage views are fully usable on touch devices: upload via the file picker (with camera capture on phones/tablets), Featured reorder via touch-drag, bulk actions via the explicit selection mode (§8.4).
- All actions are reachable with keyboard only (§6.6) and screen readers announce the active item, its caption, and its position in the gallery.

## 15. Prerequisites — recorded in `docs/decisions.md`

Resolved on 2026-10-01 and 2026-10-02 before implementation:

1. **Kiosk defaults for `media_consent`** (§10.2) — recorded in [`docs/decisions.md`](decisions.md) under "Media consent at kiosk".
2. **Plan shape and numeric values** (§8.5) — recorded in [`docs/decisions.md`](decisions.md) under "Organizer `DEFAULT_PLAN` values (Phase 1, config-only)", covering media MIME allowlist, per-file size cap, per-event photo and video count caps, global per-account byte backstop, presigned URL expiry, scale caps (series/events/capacity), and reserved conversion-lever fields.
3. **Media delivery subdomain, S3 object layout, and CloudFront topology** — recorded in [`docs/decisions.md`](decisions.md) under "Media delivery".

Implementation sequencing lives in [`media-gallery-plan.md`](media-gallery-plan.md).

## 16. Explicitly out of scope for Phase 1

- Reactions, comments, likes-based sort (planned; UI reserves space where noted).
- Per-event and per-performer filter pickers on public galleries (URL query params reserved).
- Video hover-previews that autoload provider iframes on hover.
- Paste-from-clipboard uploads.
- Embed-code copy affordance for videos.
- On-the-fly image resizing (baseline ships with pre-generated renditions).
- Video providers beyond YouTube and Vimeo.
- Broadening the Plan concept beyond media quotas.
- Per-item takedown request flow for free-standing media that depicts a person who has revoked consent.
- Multi-tenant per-organizer branding of the gallery presentation.
- Custom fullscreen player controls (Phase 1 uses provider-native controls).

## 17. Success criteria (behavioural)

The design is judged successful when a first-time public visitor to a busy event page can:

1. See a full-screen-worth of media within one scroll gesture, without a spinner.
2. Open any item into a lightbox that stays responsive on 3G, unmounts cleanly, and returns them to the exact same scroll position.
3. Share any item into WhatsApp and iMessage and see a preview card that shows the correct image and a caption that reads naturally.
4. Navigate the entire gallery — Prev, Next, close, reopen a different tile, share, download — using only the keyboard, with a screen reader announcing the current item.
5. Never encounter a broken caption ("Amy Hart from Unknown," "Amy Hart —") regardless of what the underlying registration looks like.

And when an organizer can:

1. Drop 40 photos onto the event manage view, attribute all of them to the performer whose set they shot, and preview the gallery as a visitor would see it — all within a few minutes.
2. Reorder the Featured strip on the series page in a few drags.
3. Restore a soft-deleted item that was deleted by mistake without losing its position in the chronology.
