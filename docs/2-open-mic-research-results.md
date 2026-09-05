# Open Mic Scope Report
 **Date:** 2026-08-16
 
 ## Executive Summary
 This report captures the finalized product scope for Open Mic Phase 1 and beyond. Phase 1 focuses on organizer workflows, low-friction performer registration, public read-only pages, and organizer-owned content. The near-term operating profile is a very small launch footprint with only a few open-mics and event registrations typically in the few-dozen range per event. The long-term ambition is a much broader platform with hundreds of open-mics and multiple overlapping active events on a given night. The primary success metric remains registrations per event, with UX optimized for non-technical users through sensible defaults and flexible performer data entry.
 
 ## Finalized Scope Decisions
1. Phase 1 delivery focuses on organizer operations and low-friction performer registration; community interaction is deferred.
 2. Primary metric is registrations per event.
 3. UX objective: easy for non-technical users, sensible defaults, and multiple ways for performers to provide details.
 4. Consent defaults to **yes** for publishing photos/videos for both guest and registered performers.
 5. Organizers always retain edit rights.
6. In Phase 1, organizers can add and manage photos and video links for their open-mic and events. Performer-authored content is deferred.
 7. Performers cannot hide their name or attendance status.
 8. Organizers may hide/delete attendee visibility when needed.
9. Reviews, comments, reactions, and messaging are deferred until after the registration and organizer workflows are proven.
 10. Multi-admin organizer collaboration is post-MVP.
 11. Performers can maintain multiple identities.
 12. Organizers can manage multiple open-mics.
 
 ## Scale Assumptions and Capacity Envelope
 
 ### Initial state
 - Launch with very few open-mics.
 - Early rollout is intentionally narrow to validate core organizer and performer flows.
 
 ### Near-term expected event size
 - Per-event registrations are expected to be only a few dozen initially.
 - Product priorities should optimize smooth registration and event-night management at this scale.
 
 ### Long-term growth target
 - Platform ambition is to support hundreds of open-mics over time.
 - Multiple events may be active concurrently on the same night across the platform.
 
 ### Scope implication notes (feature-level)
 - Phase 1 should prioritize reliable single-event operations and low-friction signup.
 - Core information architecture should already account for organizers with multiple open-mics and performers with multiple identities.
 - Public discovery and event navigation should be structured so expansion to many open-mics does not require scope redefinition.
 - Platform-level visibility (not just event-level outcomes) should be included in measurement from early phases.
 
## Phase 1 Scope (in)
 - Organizer-first workflows and controls.
- Organizer workflows for creating and managing open-mic series, events, registration settings, and rosters.
- Performer sign-up and registration flows, including guest registration and authenticated registration with minimal friction.
- Public read-only home, profile, open-mic, event, and registration pages.
- Organizer-owned photos and video links on open-mic and event pages.
- Consent defaults enabled for media publishing where registration consent is collected.
- Permission model: organizers manage their series, events, organizer content, and roster visibility; performers register and manage only their registration details.
 - Organizers managing multiple open-mics.
 
## Later Scope (out of Phase 1)
 - Multi-admin organizer collaboration.
- Performer-authored photos, videos, profile content, and other media.
- Reviews, comments, reactions, private messaging, follows, and notifications beyond registration operations.
- Expanded public discovery and personalization.
 
 ## Feature Guardrails / Permissions Rules
 - Default publishing consent for photos/videos is **yes** for guest and registered performers.
 - Organizer authority is always preserved for event integrity/moderation.
- Phase 1 performer self-service is limited to account creation, profile selection, registration, and permitted registration detail edits.
- Phase 1 organizers own all published photos and video links.
- Community interaction is not available in Phase 1.
 - Name and attendance visibility cannot be suppressed by performers.
 - Organizer moderation may override attendee visibility when necessary.
 
 ## Success Metrics (primary + supporting)
 **Primary**
 - Registrations per event.
 
 **Supporting**
 - Open-mic growth count over time.
 - Concurrent active events (platform level).
 - Registration conversion rate (visits → registrations).
 - Registration completion rate.
 - Time-to-register (median).
 - Organizer setup completion rate.
 - Performer profile completion rate.
 - Drop-off rate by step in registration flow.
 - Repeat registrations (return performers).
 
## Suggested Next Steps (practical sequence)
1. Define and wireframe the organizer console, registration flow, and Phase 1 page contracts.
2. Implement open-mic and event creation, editing, lifecycle, and roster operations.
3. Implement guest and authenticated performer registration with the fewest practical steps.
4. Implement organizer-owned photo/video content and the public read-only pages.
5. Instrument registration conversion, completion time, and organizer setup metrics.
6. Validate capacity, consent, roster visibility, and registration recovery end-to-end.
7. Launch with a small initial set of open-mics and validate event operations.
8. Add performer ownership and self-service identity features after Phase 1 evidence.
9. Add community and discovery features only after the registration loop is stable.