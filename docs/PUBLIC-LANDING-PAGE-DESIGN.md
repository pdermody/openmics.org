# Public Open-Mic and Event Landing Pages

**Status:** Implemented and regression-validated; database rollout has not been performed.
**Date:** 2026-10-10
**Scope:** Public landing-page information, a single venue map, driving directions, and the supporting organizer experience.

## 1. Goal

A visitor should be able to answer these questions without entering an organizer dashboard:

- What is this open mic like, and is it suitable for me?
- When does it happen, and when does this particular event finish?
- Where exactly is it, and how do I drive there?
- What does it cost, and how do I register?
- Is attendance already at the organizer's suggested limit?

The landing page stays compact on first arrival. Series and event facts use badges, followed by plain venue/city text and **More details** in the same wrapping row. Registration appears beside the highlighted running/next event only when an eligible registration event exists. More details opens a separate page containing the longer information, full address, map, and directions. Venue labels are not links on either landing page. A prominent back button returns to the corresponding landing page.

This document describes the approved user experience. The original design-only task changed only this document; implementation was subsequently authorized, including API, code, tests and aligned guidance.

## 2. Decisions agreed with the user

| Topic | Agreed design |
|---|---|
| Map scope | Show the venue of the open mic or event being viewed. Do not add a multiple-listing map or nearby map discovery. |
| Location interaction | Location, address, map, and directions are on the separate More details page. Series and event venue/city labels are plain text after the badges, followed by More details. The map loads only after an explicit action there. |
| Navigation | Offer Google Maps and Apple Maps driving-directions links. |
| Information layout | A compact summary with a separate More details page and a back button to the landing page, not a modal, inline expandable section, or additional About tab. This keeps the landing page uncluttered. |
| Private notes | Keep existing event notes organizer-only. Do not migrate or publish their contents. |
| Public information | Add the same separate public-information field to open mics and events. A new event inherits an editable copy at creation, not a continuously synchronized value. |
| Meaning of capacity | An attendance limit including performers and audience guests, not just a performer-registration limit. |
| Enforcement | Capacity is a soft limit for warnings only. Reaching it does not automatically stop online or kiosk registration. This replaces the earlier suggestion to stop registration at the limit. |
| Audience counting | Organizers manually record the audience guest count; audience guests do not need individual registration records. |
| Warning calculation | Confirmed performer registrations plus manually recorded audience guests, labelled as an attendance estimate. |
| Public capacity display | Show an at-capacity warning when appropriate, rather than numerical limits or remaining-place counts. |

## 3. Relationship to current guidance and implementation

The proposal follows the existing public visibility, canonical-handle, and media-browsing rules in [recorded decisions](docs/decisions.md), [product requirements](docs/3-open-mic-requirements.md), [vanity URLs](docs/6-open-mic-vanity-urls.md), and [frontend architecture](docs/5-open-mic-frontend-architecture.md).

Before this enhancement, the [landing-page implementation](apps/web/src/views/DetailPage.tsx) showed a description or event notes, a short venue/city label, registration actions, and event/media browsing. It did not provide the complete structured information described here. Event dates also needed explicit venue-local presentation.

The implementation resolved these original differences:

| Current boundary or conflict | Proposed resolution |
|---|---|
| The [feature plan](docs/FEATURE-PLAN.md) excludes public maps from the existing location slice; map discovery remains deferred in recorded decisions. | Authorize a separate single-venue landing-page enhancement. Do not reinterpret this as approval for map discovery or alter the existing slice silently. |
| The canonical route map does not currently define separate public More details pages. | Add resource-scoped details routes and their canonical redirects to the route guidance before implementation. Existing landing and registration URLs remain unchanged. |
| The [data model](docs/architecture/data-model.md) calls event notes private, while the current landing page renders them publicly. | Remove private notes from public presentation and public serialization. Introduce a distinct public-information field, initially empty for existing records. |
| Existing requirements and registration behavior enforce a performer-registration capacity ceiling, with kiosk exemptions. | Replace this admission rule with the user-approved soft attendance warning. Capacity alone must no longer reject otherwise eligible registration. |
| Recorded decisions cap the configurable event capacity under the organizer's plan. | Preserve that separate plan/configuration constraint unless explicitly changed later. A soft attendance warning does not authorize changing commercial plan entitlements. |
| The [API contract](openapi.yaml), data model, and frontend public-read types do not fully align on all landing-page fields, including event fee details. Public information, audience count, and attendance-warning status are new requirements. | Reconcile the contract and visibility-safe public responses before wiring the UI. Do not fill gaps with mocks, invented values, or private organizer responses. |

The agreed changes are now recorded in [the decision record](docs/decisions.md#public-landing-page-details-and-attendance), with aligned requirements, feature sequencing, data model, API design, contract and frontend guidance. The table above documents the original conflicts and their approved resolutions, rather than overriding those authorities silently.

## 4. Shared page structure

Both landing pages use the same readable structure:

```text
Title and open-mic/event identity
Short description or public-information preview, when supplied
Schedule | Activities | Entry fee | Registration type | Tags (badges)
Venue, city (plain series text / event Location link) | [More details]
At-capacity warning, when applicable to the event
Highlighted running/next event with registration when available

[More details] navigates to a separate page:
  [Back to open mic / Back to event]
  More details - Open-mic or event name
  About / Event information
  Schedule / When
  Activities and tags
  Performance and age policies
  Entry and registration
  Website / Related open mic

  Location
    Venue name
    Full address
    [Show map]
    [Drive with Google Maps] [Drive with Apple Maps]

Landing page retains existing event browsing and photo/video tabs
```

- More details is a navigation link styled as a button. It opens a separate public page in the same tab, without changing the landing page's saved event or media tab.
- The summary includes important restrictions such as **Originals only** and the age policy when supplied, so a visitor need not open More details to discover a restriction.
- Avoid duplicating a full description in the summary and details page. A long summary preview ends with a **Read more** link to the matching detail section.
- Series and event venue/city labels are non-interactive text after the fact/tag badges and before More details. Navigation to More details does not automatically load the map.
- The details page is independent of the existing browsing tabs. Series Events/Photos/Videos and event Photos/Videos retain their current defaults, filters, pagination, and history behavior.
- Featured-strip arrows appear only in directions with additional off-screen items. They disappear when all items fit and update after scrolling or resizing.
- Organizer edit/manage controls remain separate and permission-gated. Visitors never need an account to read public details, see the venue, or open directions.
- On mobile, use a normal one-column page with wrapping values. On wider screens, related detail groups may use two columns without changing reading order. Use ordinary document scrolling, not a dialog or nested scrolling panel.
- More details opens at the page's beginning; Read more and View location target their named sections. A prominent **Back to open mic** or **Back to event** control appears before the page title.
- Navigation uses normal browser history. The back control returns to this resource's landing page, restoring its browsing state, scroll position, and originating-control focus when available. If the details page was opened directly or refreshed without saved return state, the control still links to the canonical landing page rather than taking the visitor to an unrelated previous site. Browser Back/Forward remains functional.

### Details-page URLs and direct access

Use a `/details` suffix under each existing canonical resource URL:

- Open mic: `/@:handle/details`.
- Event: `/@:handle/events/:eventId/details`.
- Location shortcuts append `#location`; description/public-information shortcuts target stable section fragments on the same page.

These additions are now recorded in the route map. Apply the same visibility checks, canonical casing, and retired-handle redirects as the corresponding landing page, preserving the details suffix and section fragment during canonicalization. Direct links and reloads must render the full details page without requiring an earlier landing-page visit. Return targets remain internal links to the same resource; no arbitrary external return URL is needed.

## 5. Open-mic landing page

### Details-page visual treatment

The details page uses a welcoming "Your night at a glance" introduction rather than a field-by-field datasheet. A theme-aware title panel leads into the organizer's description and a distinct visitor-information note. "The vibe" groups activities and tags; "Taking the stage" groups performance and age policies. Event policies remain explicitly identified as series-level.

A "Before you go" visit card groups schedule/time range, entry fee, registration, website, and "Getting there" with the full address and explicitly loaded map. On desktop the story and visit card sit side by side; mobile stacks them in reading order. Icons and restrained accent colours establish hierarchy without inventing atmosphere, amenities or suitability claims. Sparse descriptions receive an honest missing-introduction message. Section anchors and back-state restoration remain unchanged.

The More details label uses readable sans-serif text with relaxed letter spacing. Activity/tag badges pair theme-aware surface and text colours in both modes. Schedule, Entry, Registration and Location share compact icon headings. Page/section headings retain navigation focus without a selection-like outline; interactive controls retain visible keyboard focus.

### Compact summary

Show the name, canonical handle where currently appropriate, a short description preview, schedule summary, activities, entry-fee label, registration type, and tags as compact non-interactive badges. Follow the badges with plain venue/city text and More details. Place the durable registration action beside the highlighted running/next event only when an eligible registration event exists; do not offer it for a series with no such event.

A series schedule describes the usual pattern; the next event is a specific dated occurrence. If they differ, the dated event's information is authoritative for that occurrence. A series with no upcoming event can still show its usual schedule without inventing a next date.

### More details

| Group | What the visitor sees |
|---|---|
| About | Full description and a separate **Information for visitors** block when the new public-information field is populated. Preserve paragraphs and line breaks. |
| Schedule | Schedule summary and full schedule details, with the series time zone where relevant. Link to the next published event when available. |
| Activities | Readable activity labels, such as Singing, Poetry, Comedy, or Storytelling. |
| Tags | Clearly labelled tags. They are informational, not implied search/filter actions. |
| Performance policy | **Originals only** or **Originals and covers welcome**, based on the stored setting. |
| Amplification | **Amplification available** or **Amplification not provided**, based on the stored setting; do not invent equipment specifications. |
| Age policy | Adults only, Children only, or Adults and children, using the existing policy without inventing an age threshold. |
| Entry | Free entry, a localized amount with its currency, or the organizer's fee note. |
| Registration | Plain-language explanation of the registration mode and the appropriate action. |
| Website | A clearly labelled external website link when configured, except links to openmics.org itself (including its subdomains). The same omission applies to the event's open-mic website shortcut. |

The Location section on the details page shows the series' full venue address and saved venue pin. Latitude and longitude are not displayed as numeric facts.

Do not add contact email publication merely because the organizer form stores an email address. This design does not change contact-data visibility.

## 6. Event landing page

### Compact summary

Show the event title, a link back to its open mic, venue/city, full start/end range in the event's time zone, effective activities, entry-fee label, registration state, and any at-capacity warning.

- Use locale-aware dates and times in the event's venue time zone, not the viewer's device time zone.
- For a same-day event, a compact range is sufficient: `Saturday 17 October, 19:00-22:00 (Europe/Dublin)`.
- For an overnight event, show both dates: `Saturday 17 October, 22:00 - Sunday 18 October, 01:00 (Europe/Dublin)`.
- If there is no end time, show **End time not specified**, not an assumed duration.
- Keep published/running/past and registration-open/closed distinctions. An at-capacity warning is not a new event lifecycle state.

### More details

| Group | What the visitor sees |
|---|---|
| Event information | Full text from the new public-information field. Existing private event notes never appear here or in the summary. |
| When | Start date/time, end date/time or explicit missing-end state, and venue time zone. |
| Activities and tags | This event's effective activities and its own tags. |
| Entry | Effective event fee, using the existing event override/inheritance rules. |
| Registration | Series registration mode plus the event's current eligibility and closure state. |
| Open-mic policies | Clearly labelled series-level originals, amplification, and age policies, rather than pretending they are event-specific overrides. |
| Related open mic | Link to the series for its description, usual schedule, and website. A website shortcut may be labelled **Open-mic website**. |

Use the event's stored venue/address/coordinates, including for a past event or one at a different venue. Never replace missing event location data with the series' current venue without an explicitly authorized inheritance rule. An event snapshot must not move when the series location changes.

## 7. Public information and organizer editing

Introduce one separate optional public-information field on both resources:

- Open-mic edit label: **Information for visitors**.
- Event edit label: **Event information**.
- Help text: **Shown publicly on the landing page. Do not include private attendee or organizer information.**
- Keep existing event notes in a distinctly labelled **Private organizer notes** field.
- Use plain text with preserved line breaks; do not render arbitrary HTML.

For creation from series defaults, copy the series public information into the new event's editable field. For creation by copying an event, copy that source event's public information alongside its other reusable details. An organizer can change or clear the new event's text before publishing.

This is a creation-time snapshot: subsequent series/source-event edits do not alter existing events. An intentionally empty event value does not fall back to the current series text on public reads.

For existing records, initialize the new field empty. Do not copy private notes into it, and do not backfill old events from today's series information. Organizers can review and populate it explicitly. A description remains a description; it is not silently migrated into this field.

## 8. Location, map, and driving directions

### Arriving at Location

Series and event visitors follow More details and scroll to Location. The full address, map, and directions are not separate blocks on the landing page. At Location, the visitor sees:

1. Venue name.
2. Address lines, postcode, city, and country in a readable block.
3. **Show map**, when a complete usable saved coordinate pair is available.
4. **Drive with Google Maps** and **Drive with Apple Maps**, when a usable destination exists.

Address and directions are available without loading the embedded map. A small notice beside Show map explains that loading it contacts an external map provider.

### Loading the map

- Reuse the settled Leaflet/OpenStreetMap rendering choice, in a read-only presentation rather than the organizer's editable location picker.
- Load map assets and tiles on explicit request, not merely on landing/details page load or arrival at Location.
- Show map opens a roomy, viewport-bounded modal rather than squeezing the map into the visit card. All screen widths use the small visible viewport and safe-area allowances, including tablets above the desktop breakpoint. Desktop size is capped at 1000px wide and 760px high, with at least 24px clearance on each side. Mobile is top-anchored with 12px clearance. The map flexes into the remaining space and recalculates its dimensions on resize; unusually long venue/address content can scroll within the dialog rather than clipping. The modal shows the venue/address, supports mouse-wheel zoom and dragging, and has a close button and Escape dismissal. Focus returns to Show map on close; the map is unmounted while closed.
- Leave a clear gap between map-provider information and Show map, and separate Show map from the driving-provider information and directions buttons.
- Show one pin at the saved venue coordinates, with the venue name and address. No other listings, draggable pin, or coordinate editor.
- Permit ordinary zoom and pan. Keep provider attribution visible and follow the tile provider's usage policy.
- Do not substitute a catalogue city centre for an exact venue pin or perform anonymous address geocoding.
- When coordinates are absent, say **A precise venue map is not available** and retain the address and external address-based directions.
- When the map fails to load, show an explicit error and Retry action. Keep all textual information and directions usable.
- If the browser cannot load the map's application assets, retry reloads the details page and asks the visitor to select Show map again. Browsers cache failed module imports within a page, so repeating the same import cannot reliably recover. Tile or rendering failures retry the map locally.

### Driving directions

- Provide two explicit provider links rather than guessing the installed app or silently redirecting.
- Prefer the saved venue coordinates as the destination. If absent, use the complete formatted address, and identify that the destination is address-based.
- Request driving directions, not just a general map search.
- Do not supply a starting point or request browser geolocation. The selected app/site can ask for the starting point.
- Use documented HTTPS navigation links, so they work on desktop and can hand off to an installed mobile app where supported. Do not depend on custom app-only URL schemes.
- Explain that directions open an external service and that the destination is shared with that service. Coordinates can be present in a navigation URL without being shown as on-page numeric facts.
- Clearly signal an external/new-tab action. Opening directions leaves the details page available at Location and preserves the return path to the landing page.
- If the destination is incomplete, do not produce a misleading directions link. Show **Directions unavailable: venue address or map location is missing**.

The map is a venue-finding aid, not a promise about parking, accessibility, entrance location, travel time, or route accuracy. Only display such advice if the organizer supplies it as public information.

## 9. Attendance estimate and at-capacity warning

### Meaning and calculation

Rename the organizer-facing meaning to **Suggested attendance limit**. It is a soft planning threshold, not a hard seating guarantee or a performer slot allocation.

The estimate combines:

- Confirmed, non-deleted performer registrations, counted once per registration, including confirmed account-free and kiosk performers.
- A manually maintained audience guest count, excluding those performers.

Pending/unverified registrations do not count. Cancelled/no-show performers are excluded; hiding a performer's public identity does not remove their contribution. Multiple performance sets do not multiply one registration's attendance contribution. Claims and attribution changes do not change the count.

This is an estimate of expected attendance, not a live door count. Confirmed performers may not attend; audience recording may lag behind reality.

### Organizer experience

In event management/roster:

- Show the suggested limit, confirmed performer contribution, audience guest count, combined estimate, and warning state.
- Provide an editable non-negative integer **Audience guests** count, initially zero for a new event. Help text states that it excludes registered performers and is manually maintained.
- Let the organizer replace/correct the count rather than requiring named audience registrations.
- Report save errors explicitly; a failed save must not appear to update the public warning.
- New events and event copies reset the audience count to zero; attendance data is never copied.
- Preserve authorization and manual registration closure. Audience counts are organizer-managed, not visitor-editable.

Existing records need an explicit unrecorded/unknown audience state until reviewed, rather than being presented as known zero. If the known performer contribution alone reaches the threshold, a warning is justified even with unknown audience attendance; otherwise an incomplete estimate must not produce an assurance that space is available.

### Visitor experience

At or above the threshold, show near the registration action:

> **This event is at capacity.** You may have trouble finding seating or performing.
>
> Based on estimated attendance: confirmed performers and audience guests recorded by the organizer. Registration does not guarantee seating or a performance slot.

- Do not show the numerical limit, attendance count, or remaining places publicly.
- Below the threshold, omit the warning; do not claim **Seats available**.
- If attendance status cannot be loaded or is incomplete, show **Attendance information is unavailable or incomplete** where relevant, without treating that as an empty event.
- If no usable threshold exists, no at-capacity conclusion can be made.
- If the organizer corrects attendance below the threshold, clear the warning on the next successful status refresh.
- Keep this warning on the event page and its registration flow. The series' highlighted next/running event can show the same event-specific warning, but the series itself is not labelled full.
- For past events, omit a present-tense travel/admission warning. Retain the existing past-event presentation.

### Registration behavior

Capacity alone never disables Register, closes registration, rejects submission, or blocks confirmation. Online and kiosk submissions remain subject to their other existing authorization, verification, duplicate, mode, publication, phase, and closure rules.

Manual closure still controls ordinary online registration. Existing organizer-supervised/presence-token kiosk closure exemptions remain unchanged; this design does not make the kiosk subject to online closure rules.

Provide the public warning as a visibility-safe server-calculated status. Do not download the private roster into the browser to calculate it. Revalidate when entering the page, returning to it, and entering/submitting registration; do not add a public roster stream or promise live occupancy. Warning-status failure is surfaced but is not itself an admission block.

## 10. Fees, registration labels, and missing information

Fee presentation follows the existing data-model rule:

1. A supplied fee note is the displayed entry-fee text, instead of the formatted amount.
2. Otherwise, an effective amount of zero means **Free entry**.
3. Otherwise, display the localized amount with an unambiguous currency.
4. Missing or inconsistent fee data means **Entry fee not specified**, never assumed free.

Event fees use the established event override/inheritance semantics. Do not infer ticket purchase, audience registration, payment processing, or a price per performer from an entry-fee field.

| Registration mode | Public explanation and action |
|---|---|
| Pre-registration only | **Register in advance**; use the existing eligible event registration flow. |
| On-the-night only | **Sign up at the venue**; no ordinary advance-registration action. |
| Both | **Register in advance or sign up at the venue**. |
| External | **Register on the organizer's website**, with the configured external registration link. Do not promise external availability based on local closure/capacity. |

A registration mode describes how performers sign up. Audience guests are counted by the organizer, not silently enrolled through these actions. The series retains its durable next-event registration link and existing no-next-event fallback.

Optional empty text, website, and tags can be omitted from More details. Important missing facts such as an end time, schedule, fee, or usable location get explicit **Not specified/unavailable** wording. Unknown booleans are not treated as false. Never substitute promotional copy for an absent description or public-information field.

## 11. Accessibility, visibility, and failure states

- More details, Read more, View location, and the back control are descriptive navigation links with visible keyboard focus. The details page has a resource-specific document title, one main heading, and clearly labelled sections.
- On in-app navigation, move focus to the page heading or requested section and respect reduced-motion preferences. Use normal page navigation: no modal semantics, focus trapping, background-scroll lock, or Escape-to-close behavior. Returning restores landing-page focus and scroll when saved state is available.
- The map modal contains keyboard focus and locks background scrolling while open. Mouse-wheel input over the map zooms it. Closing restores focus to Show map; address and directions outside the modal remain the non-map alternative.
- Use text plus icons for facts and warnings, not colour alone. Website and directions links have descriptive names.
- Localize labels, activity names, policy names, fee formatting, and date/time presentation.
- Existing API-enforced public visibility remains authoritative: draft/deleted/unavailable records and paused-series descendants do not gain public map or information access.
- Public payloads and page/OG output exclude private event notes, registration contacts, moderation data, audience identities, and organizer-only fields.
- Detail-read failures show an explicit retry state, not successful-looking placeholders. Map failure does not hide the address; parent-series failure does not fabricate inherited event policies or fees.
- Preserve canonical handle casing, redirects, registration routes, and browsing history. Add resource-scoped details routes as proposed above; no standalone map-discovery route is required.

## 12. Acceptance scenarios

1. An anonymous visitor opens an open mic, sees its compact facts, follows More details to a separate page, and reads its full description, website, schedule, activities, tags, policies, entry fee, and registration explanation.
2. Series and event facts appear as badges followed by a plain venue/city label and More details. Venue labels are not links. No full Location block remains on either landing page.
3. No map-provider request occurs until Show map is selected. A valid saved pin appears without numerical latitude/longitude labels.
4. Google Maps and Apple Maps actions request driving directions to the current page's venue and work without the site requesting the visitor's location.
5. An event at an alternate venue uses its own snapshot for address, map, and navigation, even after the parent series is edited.
6. Missing coordinates retain the full address and address-based directions. Map-provider failure exposes Retry while the page remains useful.
7. A visitor in another time zone sees venue-local start/end times. Overnight dates and missing end times are explicit.
8. Private notes never reach the public page or public response. Separately entered public information is visible.
9. New events inherit editable public information; edits to a series do not rewrite existing events. Event copies copy public information but not audience counts.
10. A fee note overrides the formatted fee; zero is shown as free only when known; event override/inheritance and currency labels are correct.
11. For a suggested limit of 40, 30 confirmed performers plus 10 recorded audience guests trigger the warning; 30 plus 9 do not. Counts above 40 continue to warn. Public pages do not expose these numbers.
12. Pending registrations, cancelled/no-show performers, and duplicate performance sets do not inflate the estimate; hidden identities still contribute without being exposed.
13. At capacity, otherwise eligible online/kiosk registration and later confirmation still succeed. Manual online closure, duplicate protection, and other eligibility rules continue to work.
14. Unknown audience attendance or status-fetch failure never produces **Seats available** or a fabricated zero estimate. Known performers alone can establish that a threshold is reached.
15. Keyboard and mobile users can navigate to details, reach Location, and use directions without interacting with the map. The visible back control returns to the corresponding landing page and restores saved scroll, focus, and event/media browsing state.
16. Directly opening or reloading a details URL, including `#location`, works without a preceding landing-page visit. The back control still reaches the correct canonical landing page; browser Back/Forward and canonical-handle redirects preserve the intended destination.

## 13. Implementation boundaries

The implementation is a coordinated behavior change, not just additional markup. It covers separate public details pages and route/return-state handling, visibility-safe public detail responses, public-information persistence and organizer forms, event creation/copying, attendance count/status, public landing and registration warnings, removal of hard capacity admission rejection, and related regression tests.

The sources listed in section 3 are aligned with this behavior. Capacity admission checks and their API errors were removed while plan limits remain distinct from admission warnings. Exact API operations are recorded in [the API contract](openapi.yaml), and persistence is introduced by [migration 022](apps/api/migrations/022_public_details_and_attendance.cjs).

Out of scope: public map discovery, selecting multiple listings on a map, audience ticketing/individual guest accounts, seating allocation, performer-slot guarantees, calendar export, route calculation inside Open Mic, reviews, reactions, follows, and other deferred social features.

## 14. Verification and rollout

API typecheck, the API suite, affected API unit tests, public-read/registration database integration tests, the complete web suite, the web production build, OpenAPI validation/lint, localization checks, and documentation links passed. Regression coverage includes private-field exclusion, exact attendance thresholds, legacy unknown audience counts, snapshot copying/clearing, canonical redirects, location anchors, back navigation, and map failure/retry.

Browser checks used public test fixtures against the production web build, without changing a configured database. They verified details navigation, restored browsing state and focus, direct Location access, lazy map loading, driving links, and a mobile-width layout. Failed application-asset imports require the explicit reload recovery described above.

Changed-file frontend lint still reports existing route-hook errors and React advisories; comparison against the original files confirmed those findings pre-date this work. They are not new validation failures introduced by this enhancement.

Migration 022 was exercised only in isolated Testcontainers databases. Apply it through the normal authorized database-release process before running the updated API against an existing database. No deployment or configured/shared database migration was performed.
