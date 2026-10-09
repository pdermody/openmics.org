# Event Creation — Design Specification

**Status:** Implemented  
**Scope:** Organizer experience for creating a new event from series defaults or by copying an existing event. Product and interaction design only; this document does not prescribe API shapes, schemas, or implementation.

## 1. Purpose

Make it fast for organizers to schedule another event in a series without re-entering details they have already configured. Keep the existing series-default creation path available for events that differ, while making common repeats a date-first task.

## 2. Goals

- Reduce repeated entry of venue, registration, and event details.
- Let an organizer copy an event directly from the public series page or choose a source from the organizer series dashboard.
- Make choosing a source event optional; organizers can still start with the series defaults.
- Ensure a copied event is a new, independent event, not a continuation of the source event's lifecycle or attendee data.
- Keep every create action restricted to an organizer who can manage the series.

## 3. Non-goals

- Recurring schedules, automatic event generation, or calendar integrations in the initial design.
- Bulk creation of many events in one operation.
- Copying registrations, performers, event media, QR codes, or other event-specific records.
- Changing the existing event editor, API contract, permission model, or series defaults as part of this design.

## 4. Entry points

### 4.1 Public series page: `/open-mics/{id}`

The public series page is viewable by everyone, but creation controls are visible only when the signed-in user's active organizer profile owns the series and can manage its events. The API remains authoritative for authorization.

Provide two entry points:

1. **Per-event “Copy” action.** Place this alongside each event displayed on the series page: the current/next event highlight and each event card in the public Events tab. Selecting it uses that event as the source. Prefill editable start/end date-time fields from the source's local schedule, preserving the source time zone and any overnight end date. The organizer changes the date directly in “Starts at”; do not add a separate “New event date” field or date confirmation.
2. **Series-level “New event” action.** This opens the create flow with an optional source-event selector. The organizer can select any non-deleted past or upcoming event in the series, or leave the selector at “Use series defaults.” With a source selected, ask for the new date and start time; carry over the source duration and time zone. With no source selected, retain the existing series-default flow.

The series-level path is useful when the source event is not currently displayed in the highlight or paginated Events tab. The source selector should not imply that the public page already displays a complete event history.

### 4.2 Organizer series dashboard

Keep “New Event” in the existing series actions menu. The create page offers an optional “Start from” choice:

- **Series defaults** — selected by default; preserves today's creation behavior.
- **An existing event** — choose from the series' non-deleted past or upcoming events.

The source list should identify events with enough context to distinguish them, such as title, date/time, venue, and lifecycle status. Show at most 10 options: up to five nearest upcoming and five most recent past events, filling unused places by proximity to the current time. Selecting a source prefills the existing “Starts at” and “Ends at” date/time inputs without making the organizer navigate away to inspect the source.

### 4.3 Shared form and navigation

All entry points lead to the existing dedicated event-create route, rather than a second event editor or a modal-only create flow. A direct “Copy event” action preselects its source; the organizer can review and edit copied values before saving.

Do not require source selection or add a multi-step wizard. Preserve the normal form's save, validation, discard, and error behavior.

## 5. Copy behavior

Copied values are initial form values only. The organizer can edit any of them before saving.

| Field or data | New-event behavior |
|---|---|
| Title | Copy as an editable starting value. |
| Date and time | Without a source event, default the end to three hours after the start. Both copy entry points prefill editable “Starts at” and “Ends at” date-times from the source's local schedule. Changing the start date/time moves the end by the source's current elapsed duration. No separate date field or date confirmation is required. Both start and end remain editable. |
| Time zone | Copy from the source event; show it with the date/time inputs. |
| Venue and location snapshot | Copy the source venue, address, city, country, and coordinates as an editable starting location. |
| Capacity | Copy as an editable value. |
| Activities and tags | Copy as editable values. |
| Notes and entry fee details | Copy as editable values. |
| Event status | Do not copy. Every new event starts as a draft. |
| Registration state | Do not copy a closed state or closure timestamp. Start with registrations open, subject to the series' registration mode and normal event rules. |
| Attendees and roster | Never copy. The new event has no registrations or performances. |
| Media, links, QR codes, IDs, and other event-specific records | Never copy; create new event-specific records only through their existing flows. |

If the source event is unavailable by the time the organizer saves, show an explicit error and preserve the values already entered. Do not silently switch to series defaults or create a partially copied event.

## 6. Date and time behavior

- For both per-event copies and the source-selector flow, prefill editable “Starts at” and “Ends at” date-time inputs from the source event. Show the end date as well as its time, including when the event ends on the following day.
- Collect the new date/time directly in “Starts at”; do not add a separate date input or date confirmation. Changing the start preserves the current elapsed duration by moving the end; editing the end updates the duration. Allow the organizer to edit both before save.
- When creating from series defaults without copying a source event, set the end date/time to three hours after the start date/time by default. The organizer can edit it before saving.
- Keep date/time interpretation in the source event's time zone, not the browser's current time zone. If an entered start/end date-time falls in a daylight-saving gap or fold, require another date/time rather than silently changing it.
- No new past-date or future-date restriction is introduced by this design; use the existing event validation rules.

## 7. Authorization and visibility

- Creation controls appear only for the owner organizer profile that is active for the session. A different active profile must not see an action based merely on another profile in the same account owning the series.
- Visitors and performers see no create/copy action on the public series page.
- UI visibility is convenience only. The existing API authorization remains the security boundary and must reject unauthorized create requests.
- If ownership or permissions cannot be established, do not render an enabled create action. Surface existing sign-in, profile-selection, or error guidance rather than implying that creation succeeded.

## 8. Empty, loading, and error states

- While series/event data or organizer permissions load, avoid a misleading active copy action.
- If the series has no source events, the optional selector explains that no events are available and leaves “Series defaults” usable.
- If a source list fails to load, report the failure and offer retry; keep the series-default path available if the series itself is loaded.
- If the selected source becomes unavailable, explain the issue and let the organizer select another source or return to series defaults without losing unrelated form input.
- On save errors, retain all entered values and use the existing field-level/server error presentation.

## 9. Accessibility and responsive behavior

- Use explicit labels for source, date, start time, and displayed end time; announce source-change updates and validation errors to assistive technology.
- The source selector must be keyboard operable and usable on narrow screens. Do not depend on hover for the per-event action.
- Keep the public page's visible action label short (“Copy”), distinct from performer registration actions, and expose a clear accessible name such as “Copy [event title].”
- Maintain visible focus, reduced-motion behavior, and the existing theme and shared form patterns.

## 10. Alternatives and recommendation

### Recommended initial design

Provide both public-series entry points and the optional dashboard source selector. Keep series defaults selected when an organizer starts from “New Event”; preselect the source only when the organizer explicitly chose a particular event's copy action. This supports a one-date quick path without taking away the flexible existing form.

### Other options

- **Series defaults only:** least UI complexity, but organizers must re-enter event-specific details and cannot quickly repeat a one-off venue/configuration.
- **Require choosing a source before creating:** makes copying discoverable but adds a mandatory decision even when series defaults are right. Not recommended.
- **Recurring template:** useful for a stable weekly schedule, but adds template lifecycle and exception handling. Consider separately after validating demand.
- **Batch dated copies:** useful for a known run of dates, but increases the impact of mistakes and needs per-date conflict/edit behavior. Defer from the initial experience.
- **Copy from event detail pages only:** direct source context is clear, but it does not help when the organizer is on the series page or wants to choose a different past/upcoming source.

## 11. Future considerations

- Revisit source-event list ordering or add search if organizers regularly cannot find a useful source within the 10-event limit.

## 12. Existing product and implementation context

- The current create route is `/dashboard/series/:seriesId/events/new`; the web frontend architecture uses dedicated create/edit routes.
- The current form pre-fills selected location and activity values from the parent series.
- The dashboard series page already has a “New Event” action in its series actions menu.
- The public series page highlights a current/next event and separately provides a paginated Events tab; owner-only copy actions accompany the displayed event entries.
- Organizer event creation is permission-gated; an owner-only shortcut must follow the existing active-profile ownership behavior.

See [decisions.md](./decisions.md) for settled product decisions and [5-open-mic-frontend-architecture.md](./5-open-mic-frontend-architecture.md) for the canonical route map.
