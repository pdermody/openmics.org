Public series events and media tabs
Problem and approach
The public series detail page renders media but has no event list. Add an events-first browsing experience with bounded server-side pagination, and replace mixed public galleries with Photos/ Videos tabs on series, event, and performer profile pages. Reuse existing gallery, lightbox, featured-media, query, and registration helpers, without reusing organizer management controls or changing the dashboard event-list API.

Planning only: no repository files have been edited. Implementation requires explicit approval. This plan supersedes the earlier discussion where it differs.

Confirmed product decisions
Series has Events, Photos, Videos tabs; Events is the default.
Event and performer-profile galleries have Photos and Videos tabs; Photos is the default. No visible All media option on these public surfaces.
Both media tabs remain visible even if one or both collections are empty; use clear, translated empty messages. Preserve profile privacy/show_gig_media rules. Organizer profiles still list their series, not a new direct-upload gallery.
Featured media is series-only. The later suggestion of event featured media was explicitly withdrawn. No event pinning model or automatic highlights.
On Events, a compact mixed featured showcase appears above the tab bar. On Photos/Videos, that showcase is hidden; matching featured items appear first inside the tab, in organizer order, and are excluded from the grid below.
Featured strips are manually browsable with mobile swiping and visible controls, not automatically rotating. Hide a strip when it has no matching featured items.
Clicking featured media opens the existing viewer over the current page without switching tabs. Closing restores focus and scroll. Viewer arrows stay within that featured selection; explicit Browse all photos/videos actions select the appropriate media tab. Offer View event when the item has an associated event.
Events has Upcoming/Past, always-visible Year, and optional Month controls. Defaults are Upcoming, All years, All months. Month requires a selected year. Changing a filter resets to page 1. Clear filters clears Year/Month.
Display and Year/Month matching use each event's venue time zone and start date, not the visitor's time zone. Running events belong to Upcoming and appear first with Happening now; future events follow nearest first. Past is newest first.
Events uses Previous/Next pages, 10 items per page, with a readable page indicator. Filters apply server-side to all matching events, not the visible batch.
Preserve selected tab, event filters/page, and browsing position on returning from an event/media item or switching tabs.
Media keeps existing Newest/Shuffle sorting and cursor loading: 24-item batches, two additional automatic batches, then Load more. No new media archive filters, event selector, performer search, or media date filters in this change.
Events already have Draft/Published only; retain these. Future/running/past remain computed time phases. Series Draft/Active/Paused/Ended is unchanged.
Paused series, their events, and their media are unavailable to public visitors. Organizer management access remains available. This explicitly supersedes the gallery design's paused-public rule and the API-design paused-directory prose.
Use a separate public-only paginated series-events operation; retain the dashboard's existing unpaginated operation and organizer lifecycle behavior.
Current implementation and constraints
apps/web/src/views/OpenMicPage.tsx delegates to DetailPage.tsx; event and profile details share this composition.
features/publicReads.ts contains event/series/next-event hooks and types. features/organizer.ts uses GET /open-mics/{id}/events as an array.
OrganizerEventsPage.tsx mixes event identity/date/venue with owner-only actions. Reuse presentation/helpers where useful, not its owner hook or action surface.
MediaGallery.tsx combines type chips, sorting, cursor pagination, featured navigation, and URL/localStorage persistence. Refactor composition surgically.
FeaturedStrip.tsx already receives items and an onOpen callback; Lightbox.tsx is reusable. Currently featured arrows can continue into the full gallery; separate featured-only sequences from normal gallery navigation.
MediaDeepLinkPage.tsx resolves canonical /media/{id} links into event/series context with media query state. App.tsx validates gallery search parameters.
Media SQL visibility and the single-item/OG visibility helper currently allow active or paused series. Correct both, their route gates, featured results, derived profile galleries, and hidden-media OG fallback handling.
Existing media endpoints allow organizer hidden-media access for management. Keep that capability; public browsing must not accidentally reveal draft media when an organizer visits a public page. Use an explicit public-read mode on shared media list/featured operations where needed, with server enforcement and backward-compatible management defaults.
Existing dirty worktree contains moved documentation and deleted utility files. Preserve it; use documents under docs/, do not recreate old root files.
The current 50-event lifetime plan cap remains unchanged. Pagination is still designed for larger collections; do not raise quotas as part of this feature.
No status data migration is needed. Add an ordered index migration only if query analysis demonstrates a missing index needed for this browsing query.
Implementation todos
1. Recording decisions and reconciling documentation
Record the confirmed decisions in docs/decisions.md before behavior changes. Align relevant sections in docs/3-open-mic-requirements.md, docs/5-open-mic-frontend-architecture.md, docs/media-gallery-design.md, docs/media-gallery-plan.md, docs/architecture/api-design.md, and docs/FEATURE-PLAN.md; update the contract-gap entry if changed. Remove contradictions about All chips, empty-gallery hiding, profile filters, featured stripping on type selection, and paused-series public visibility. Fix relative links in documents actually touched using their current locations. Do not broaden this into a cleanup of unrelated documentation drift.

2. Adding the public event-browsing contract and backend
Proposed operation: GET /open-mics/{id}/public-events, below /api. Resolve identifiers using existing UUID/public-code helpers and the resolved series ID from the frontend. Require an active, non-deleted parent; always select published, non-deleted events regardless of caller ownership.

Validate period=upcoming|past, page, page_size (UI requests 10), optional year and month with Zod and established structured errors. Reject invalid values and month without year; bound page size.

Return typed { items, pagination: { page, page_size, total }, available_years }. Available years derive from the full public collection for the chosen period, independent of pagination and selected Year/Month. Use All months plus the normal 12 month options after year selection; no metadata derived from drafts.

Implement SQL filtering, counting, year metadata, and bounded offset pagination in the events repository. Reuse the existing event serializer/phase calculation. Use one consistent time reference for classification within a request: running if starts_at <= now and ends_at > now; past once ends_at <= now; future otherwise according to the existing event phase helper. Verify null end-time handling against the current serializer rather than inventing another classification. Published events normally require an end time.

Upcoming orders running first, then starts_at ascending with stable ID tie-break; Past orders starts_at descending with stable ID tie-break. Date filtering uses starts_at AT TIME ZONE time_zone. Return explicit empty results for valid pages with no matches; the UI handles a last page disappearing after live changes.

Document operation, parameter constraints, errors, metadata, and response in openapi.yaml. Do not change GET /open-mics/{id}/events response or dashboard.

3. Aligning public media visibility
Require active parents in public media SQL and the row visibility helper. Enforce the same rule for event/series listings, featured media, profile-derived media, individual JSON reads, and canonical media HTML/OG output. For paused/draft/ended/deleted parents, do not emit media thumbnails or private parent names in public OG fallback output; use generic unavailable/site context. Retain existing consent, soft-delete, profile visibility and adoption rules. Preserve owner/admin management access on organizer surfaces. Add explicit public-view query support if shared owner-aware listings need it, document it, and wire all public consumers. Do not remove the API's internal type=all capability needed by management or mixed featured media merely because the public All tab disappears.

Known delivery boundary: hiding application pages/API/OG does not revoke an already-known raw CDN URL. Preserve existing media-delivery semantics; no AWS deployment, CDN redesign, or object deletion is included.

4. Building public event presentation and browse state
Add typed query keys/hook in features/publicReads.ts for the new operation. Build a small public event-list/card component with title linking to event detail, venue-local date/time, venue/city, and textual Happening now when applicable. Keep registration actions at the existing detail-page/header surface; do not introduce another registration-eligibility implementation in each event card. Reuse or extract existing visual/date helpers where suitable; no owner actions.

Render filters, Clear filters, 10-item pages, Previous/Next, page indicator, loading/error/retry, and informative empty states. Distinguish no upcoming events from no matches; keep Past reachable in either case. Disabled pagination controls remain understandable. On paging, move focus to an appropriate result heading and scroll predictably, not to the top of the site. Handle counts shrinking without a blank, stranded last page.

Use typed router search state for tab, period, year, month, and page; preserve independent media sort/anchor state. Back/Forward must restore state rather than relying on mount-only URL reads. Tab changes retain their existing browsing state; filters reset the event page. Use separate history state for scroll/focus and shuffle seeds, not shareable URL parameters.

5. Refactoring shared gallery tabs and featured viewers
Provide reusable accessible tab composition: Series Events/Photos/Videos and event/performer Photos/Videos. Keep organizer-profile series listing unchanged. Only the active media tab fetches/presents its matching media; retain its query cache and per-tab position across switches without rendering an unbounded hidden second gallery. Remove visible All chips and obsolete type preference behavior from public tabs; retain API compatibility and organizer tools.

Series defaults to Events; event/profile to Photos unless a valid explicit tab or media deep link selects the relevant type. Respect direct video/photo anchors, including nonfeatured items and archived items outside the initial loaded batch. Preserve /media/{id}, existing media/mediaUnavailable handling, and translate legacy type=photo|video links to the appropriate tab; type=all maps to the new page default. Featured clicks explicitly do not change the current tab.

Use separate featured-only lightbox sequences for mixed showcase and typed featured strips. Existing normal-grid viewer navigation remains within its typed collection. Include matching featured items once in typed viewer navigation where appropriate; never duplicate tiles between strip and grid. Add Browse all photos/videos links and optional View event for featured viewers; do not navigate to an event automatically on thumbnail click.

Make the compact strips manually swipeable with accessible previous/next controls and no automatic rotation. Preserve alt text, visible video badges, keyboard navigation, focus restoration, reduced motion, and touch-sized targets. Keep featured content above grid regardless of Newest/Shuffle. Retain explicit tab empty/loading/error states and profile gallery opt-out. Translate every new label using existing locale resources.

6. Integrating and validating the full experience
Wire series list, current/next-event emphasis and existing registration action, media tabs, featured showcase, routing and public query mode into DetailPage. Use resolved entity IDs for queries; exercise UUID/public-code and vanity entry routes without changing canonical public route paths.

Add focused API/unit/integration and web tests, then browser/E2E verification:

20 events prove pages are 10,10,remainder; correct totals/Previous/Next.

Filtering spans the full dataset; venue-local year/month at UTC boundaries, DST, running/end-time transitions, tied timestamps and no matches.
Draft/deleted events never appear even for owners using the public operation; paused/draft/ended parents are unavailable while dashboard access still works.
Paused media excluded from series/event/profile listings, featured pins, JSON item reads and media-specific OG; management previews retain permitted access.
Events default, Photos default on event/profile, both empty tabs remain visible.
Featured order/type isolation/no duplicates; Events-only mixed showcase.
Featured opening/closing leaves tab/filter/page/scroll unchanged; featured arrows don't enter the full grid; Browse all and View event work.
Newest/Shuffle and hybrid Load more still work per media type.
Direct video links, old type query links, hidden media, Back/Forward and scroll restoration; performer privacy/show_gig_media and consent regression cases.
Keyboard tab operation, viewer focus return, mobile portrait/touch, theme modes, reduced motion and loading/error recovery.
Dependencies
Recording decisions precedes backend public browsing, visibility alignment, and media-tab behavior changes.
Public event presentation requires the new browsing contract/backend.
Integration requires event presentation, media tabs and visibility alignment.
Backend/visibility and gallery work can proceed independently after decisions, but implementation should use normal in-session work unless delegation is asked.
Validation commands
Use npm.cmd on this Windows environment because PowerShell blocks npm.ps1. Run focused Vitest selectors for the affected unit/API/integration and web files, then API typecheck, web build/lint and untranslated-UI check. Integration uses Testcontainers; obtain container CLI configuration before any container commands. Use existing tasks where available and unit-test tooling where supported.

npm.cmd run typecheck:api
npm.cmd run validate:openapi and npm.cmd run lint:openapi
Focused equivalents of test:unit, test:api, test:integration; target events/public-reads/media/SPA tests and new browsing tests together per runner.
Focused web detail-page/gallery/lightbox/public-read tests, web build, lint, and test:i18n.
Existing Playwright E2E setup for route/history/mobile smoke verification.
npm.cmd run check:links after directly related documentation reconciliation.
Do not deploy/bootstrap AWS, change plan quotas, install dependencies unless required by a missing-tool failure, or add Markdown linting.

Baseline findings (before repository changes)
npm.cmd run validate:openapi passed: valid OpenAPI 3.0.3.
npm.cmd run check:links failed with existing broken links, including references to documents moved from the root and root-relative links now inside docs/FEATURE-PLAN.md. These are pre-existing, not introduced by this plan. Repair links directly coupled to documents changed, report unrelated leftovers.
Initial npm invocations were blocked by PowerShell execution policy; switching to npm.cmd worked without changing machine policy.
No code tests/builds have run during planning; no repository code/docs edited.
Completion criteria
All agreed behaviors are implemented, API and documentation agree, targeted tests and builds pass, browser behavior is verified, and any pre-existing validation findings are reported separately. No unrelated dirty worktree changes are reverted.