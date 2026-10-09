# Open Mic Product Requirements Document (PRD)

**Status:** Initial Draft  
**Date:** 2026-09-05

---

## 1) Purpose and Phase 1 Scope

Open Mic helps organizers create and run open-mic series and events while making performer registration as fast and reliable as possible.

**Phase 1 priorities:**

1. Organizer workflows and open-mic operations.
2. Low-friction performer sign-up and registration.
3. Read-only public pages and organizer-owned content.

Performers can sign up, browse open-mics and events, and register in Phase 1. They cannot comment, review, react, or add photos, videos, or other public content until a later phase.

### Phase 1 goals

- Maximize registrations per event.
- Make organizer setup, event creation, and roster management low-friction.
- Support guest and authenticated performer registration.
- Provide clear public pages for the home page, profiles, open-mic series, events, and registration.
- Let organizers publish and manage photos and video links.
- Preserve the data and permission boundaries needed for later performer ownership and community features.

### Outside Phase 1

- Performer-authored photos, videos, profile content, or other media.
- Reviews, comments, reactions, private messaging, follows, and social feeds.
- Multi-admin organizer collaboration.
- Advanced discovery and recommendation features.

### Public location discovery and city entry

- Default to a 50 km search around browser location or a resolved saved city. Users can explicitly widen to find 20 additional public open-mic series, with a 200 km ceiling, or select another city.
- Empty upcoming-event and series sections remain independent and offer city search and any available expansion. Fewer than 20 additional series within the ceiling are still offered with an accurate count.
- City suggestions contain public listings themselves and are ordered by distance. A selected city starts a new 50 km search and does not change account preferences.
- Home retains three-card previews; `/discover` provides separate series/events tabs and numbered pagination. Geographic series results are nearest-first.
- City autocomplete searches the packaged, versioned JSON catalogue in bounded requests, matches Unicode/ASCII city and country spellings and displays country/region. Exact city matches rank before prefixes and other matches; population ranks within each tier. Retired entries are excluded. Search explicitly reports when a candidate's database UUID is missing and the catalogue import is required.
- All existing city fields use this autocomplete, while preserving optionality and unmatched free text. Selected cities supply country; unmatched organizer city input exposes a country selector.
- City-centre venue pins require explicit organizer confirmation/refinement before saving. Exact venue locations and historical registration snapshots must remain distinct from catalogue centres.
- City search never calls LocationIQ. Organizer address search and reverse geocoding continue to use the authenticated, budgeted provider adapter.
- Retired city references remain readable, but saving resource details requires an active selected city or clearing the reference under the existing optional/free-text rules. Lifecycle-only actions (including status changes, check-in and registration closure) remain available; mixed detail/lifecycle updates validate city selection.
- Browsing location/radius survives in-app navigation, not refresh or a new visit. Maps and personalized/social recommendations remain outside this slice.

---

## 2) Personas

1. **Organizer**
   - Creates and manages one or more open-mic series.
   - Creates and operates events.
   - Manages registration settings, roster data, visibility, and organizer-owned content.

2. **Registered performer**
   - Creates an account, browses public pages, and registers for events.
   - May select an account-owned performer profile.
   - Can edit permitted registration details, such as song names.

3. **Guest performer**
   - Registers without an existing account.
   - Provides a name, contact email, and optional city and song details.
   - Can later claim the registration after creating an account.

4. **Public viewer**
   - Browses public open-mic and event information.
   - Can follow a registration link but cannot write content or manage records.

---

## 3) Functional Requirements

### A) Organizer workflows

- An organizer can create and manage multiple open-mic series.
- An organizer can create, edit, publish, unpublish, and delete events, and can close event registrations independently. Pausing applies to the parent open-mic series, not to individual events.
- An organizer can configure registration mode, capacity, schedule, venue, and event details.
- Event creation retains series defaults and optionally allows copying one of at most 10 nearby-in-time past/upcoming events from the series, balancing up to five from each side of the current time and filling unused slots by proximity. A displayed public-series event may be copied; its editable start/end date-times are prefilled from the source's local schedule in the source time zone, including an overnight end date. Organizers choose the date and time directly in “Starts at” and “Ends at”, without a separate date field or date confirmation. Copies start as drafts with registrations open and no attendees; only reusable event details are copied. Without a source, the end defaults to three hours after the start, and start-time changes retain the selected duration.
- An organizer can view and manage the event roster.
- An organizer can add, edit, soft-delete, and recover photos and video links for their series and events.
- An organizer can hide or remove attendee visibility when required.
- Phase 1 assumes a single owner; multi-admin collaboration is deferred.

### B) Event lifecycle

- Events record start/end times, time zone, venue snapshot, capacity, registration state, and lifecycle status.
- Event creation uses sensible defaults from the parent open-mic series.
- Registration capacity is enforced atomically so concurrent submissions cannot overbook an event. Kiosk sign-ups (organizer kiosk form and kiosk QR) are exempt from capacity but still count toward it for online registrations.
- Organizers can close registrations independently of the event lifecycle.
- The event roster supports a few dozen registrations initially and remains usable during event-night operation.

### C) Performer sign-up and registration

- A visitor can register as a guest without an account.
- A guest registration requires a performer name and contact email unless entered through the organizer-supervised kiosk.
- Guest registrations remain pending until email confirmation, except kiosk registrations, which are verified by organizer presence.
- A signed-in performer can register using an account-owned performer profile.
- The registration flow must minimize required fields and steps while collecting enough information for the organizer to run the event.
- Registration supports optional city, phone, song names, referral attribution, and media consent.
- Performers cannot hide their own name or attendance status through self-service.
- A guest can edit their registration through a protected magic link.
- A performer at the venue can sign up on their own phone by scanning the kiosk's event QR code, regardless of the series' registration mode; only a name is required and the sign-up is verified by presence.

### D) Registration claiming and attribution

- A signed-in account can list guest registrations whose contact email matches its verified email.
- Claiming is explicit and never happens automatically during sign-up.
- A claim may be made at any time during or after the event.
- When claiming, the account may explicitly adopt one of its performer profiles as the public attribution.
- The registration retains its original guest provenance even when a profile is adopted.
- The registration owner may change or remove the adopted public attribution later.
- Public roster views distinguish the original guest registration from the optional adopted profile link.

### D2) Profile management

- An account can own multiple profiles of different kinds (performer, organizer); a profile's kind is fixed at creation.
- Only performer profiles have a public handle; organizer profiles are represented publicly by their open-mic series.
- Creating an open-mic series requires an active organizer profile.
- An account cannot delete its currently selected profile; it must switch to another profile first.
- An account cannot delete its last remaining profile.
- Wherever profiles of different kinds can appear together, the UI identifies each profile's kind with an icon and a text label.

### E) Organizer-owned content

- Organizers can add photos and video links to their open-mic series and events, including through a registration shortcut that attributes event media to that registration. They cannot upload media directly to organizer profiles.
- The event roster links to event media management. Registration details provide icon-only edit and add-media actions; the add-media dialog fixes attribution to that event registration and requires a valid registration with media consent, not a claimed performer account.
- Completed photo uploads in event media management allow changing or clearing performer attribution without uploading the photo again. Closing a roster upload dialog confirms cancellation of unfinished uploads; already saved media remains, and a commit already in progress may still finish.
- Organizer content is clearly attributed and shown in a labelled section on public pages.
- Organizers can edit or soft-delete their content and recover it during the configured retention period.
- Performer content upload is deferred. Performer profile galleries are derived from event media attributed to registrations that have adopted the profile; they are not a direct upload target.
- Comments, reviews, and reactions are unavailable in Phase 1.

### F) Public page visibility contract

#### Home page

- Shows upcoming events and open-mic series.
- Provides clear browse and registration paths.
- Does not show private, hidden, blacklisted, deleted, quarantined, or redirected records as discoverable items.

#### Profile page

- Shows the public profile name, profile kind, description, links, canonical handle (performer profiles only), and permitted organizer-owned content.
- Organizer profile pages list the open-mic series the organizer owns.
- Shows public attribution where a registration has explicitly adopted the profile.
- Does not expose private fields, contact email, moderation notes, or hidden/blacklisted profile details.

#### Open-mic page

- Shows series name, description, venue, schedule, activities, upcoming events, registration links, canonical handle, and organizer-owned content.
- Provides the durable next-event registration link.
- Events is the default tab, alongside Photos and Videos. Events includes Upcoming/Past, venue-local Year/Month filters, and 10-item Previous/Next pagination. Running events lead Upcoming with a "Happening now" label. Media uses separate tabs with series-only featured strips and no All option.
- Paused series and their events/media are unavailable publicly; organizer management access remains available.

#### Event page

- Shows title, date/time, venue, registration state, capacity information where appropriate, permitted roster entries, and organizer-owned photos and video links.
- Separates organizer controls from public content.
- Public media uses Photos/Videos tabs, with explicit empty states and no featured strip. Performer-profile galleries use the same tabs subject to their visibility/opt-out rules.
- Does not expose pending registrations or organizer-hidden attendee details.

#### Registration page

- Supports guest and authenticated registration.
- Shows only the fields needed to complete or edit the registration.
- Provides email confirmation and protected edit-link states without exposing tokens in the rendered page or URL after exchange.

---

## 4) Permissions Matrix

| Action | Organizer | Registered performer | Guest performer | Public |
|---|---:|---:|---:|---:|
| Create/manage open-mic series | Yes | No | No | No |
| Create/edit/operate events | Yes | No | No | No |
| Manage event registrations | Yes | Own permitted registration fields | Own guest registration via magic link | No |
| Register before or on event day | Yes | Yes | Yes | No |
| Claim guest registrations | Yes where authorized | Yes, with verified email | No | No |
| Adopt a performer profile attribution | Registration owner | Registration owner | No | No |
| Hide attendee visibility | Yes | No | No | No |
| Add/edit/delete organizer content | Yes | No in Phase 1 | No | No |
| View Phase 1 public content | Yes | Yes | Yes after verification where applicable | Yes |
| Comment, review, react, or message | Later phase | Later phase | No | No |

---

## 5) Phase 1 Acceptance Criteria

### Organizer operations

- An organizer can create an open-mic series and at least one event.
- An organizer can edit event details, configure registration, and close registrations.
- An organizer can view, update, hide, and operate the roster without overbooking.
- An organizer can publish photos and video links on the series and event pages.

### Registration

- A guest can complete registration with the minimum required fields and receives a confirmation email.
- A kiosk registration can be recorded immediately without email confirmation.
- An authenticated performer can select a performer profile and register.
- A guest can edit their registration through a protected magic link.
- A verified account can find and explicitly claim eligible historical guest registrations during or after the event.
- Registration provenance remains intact when public profile attribution is adopted or changed.

### Public pages

- Anonymous users can browse the home, profile, open-mic, event, and registration pages.
- Public pages expose only permitted, non-private content.
- Canonical handle casing and redirects work consistently.
- Pending, hidden, blacklisted, and deleted attendee information is excluded from public views.
- No Phase 1 page exposes comment, review, reaction, messaging, or performer-content controls.

### Usability and measurement

- Registration completion time and abandonment are measurable.
- Organizer setup completion and event operation are measurable.
- The initial target is a few dozen registrations per event.

---

## 6) Later Delivery Phases

### Phase 2: Performer ownership

- Guest registration claiming and profile adoption UI beyond the minimum Phase 1 flow.
- Multiple performer identities and richer performer profile editing.
- Performer-authored photos, videos, and profile content.
- Registration history and self-service improvements.

### Phase 3: Community and discovery

- Reviews and organizer responses.
- Comments, threaded replies, reactions, and moderation tooling.
- Private messaging and notification preferences.
- Public search, directories, follows, recommendations, and analytics beyond registration metrics.

Multi-admin collaboration, account deletion/export policy, paid listings, and custom domains remain separate roadmap decisions.
