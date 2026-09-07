## Plan: Build The Frontend SPA

TL;DR: Complete the API, Cognito/Amplify contract, local seed data, adapter boundaries, and infrastructure ownership first; then build `apps/web` as a React 18 + TypeScript + Vite SPA with a source-informed light/dark theme gallery, public browsing, registration, and organizer workflows. The API remains JSON-only while Amplify owns frontend-adjacent infrastructure and Terraform owns independently managed platform resources.

**Current status**

- **Implemented:** Vite React frontend shell; six musical theme families with light/dark modes and local persistence; API/query/i18n foundations; local Postgres/PostGIS seed data; public event/open-mic/profile reads; short event codes; guest registration; friendly API and form errors.
- **Partially implemented:** Amplify adapter without configured Cognito; public route coverage; API contract alignment; accessibility primitives; social affordance placeholders; account preference synchronization; public filters and route composition.
- **Not implemented:** account/auth profile/current-profile/permission APIs; production Cognito/JWT integration; authenticated registration; email/magic-link/claim UI; organizer console; media adapters; SSE; MSW/RTL/Playwright coverage; Amplify deployment configuration; CI and infrastructure validation.

**Backend/API status**

- **Implemented:** Fastify app factory and JSON boundary; profiles, handles, open-mics, events, registrations, performances; public visibility reads; handle availability; short event codes; PostGIS radius filtering; local migrations and development seed data; generic SPA entry-point fallback; three-layer coverage for implemented slices.
- **Partially implemented:** OpenAPI alignment for newer frontend surfaces; registration email/magic-link delivery adapters; account/profile context; current-profile and permission responses; Cognito JWT verification; media persistence/storage; SSE; account preferences.
- **Not implemented:** account dashboard contract, authenticated profile selection, organizer permission API, production AWS/Amplify environments, SES/S3 adapters, media routes, and confirmed SSE operations.

Completed items remain in the phases below as verification or follow-up work. Only unfinished work should be treated as the next implementation target.

**Steps**

### Phase 0: API, auth, and infrastructure readiness
1. Produce a contract-gap matrix for every selected frontend route: API operation, request/response schema, auth requirement, permission rule, visibility rule, loading/error/empty states, and test fixture. Treat `openapi.yaml` and the authoritative architecture documents as the contract sources.
2. Complete the remaining backend operations the frontend depends on before implementing their screens: account/auth profile, current-profile selection, account profiles, permissions, profile contact fields including phone storage, registration token exchange and verification, claimable registrations, media operations, and confirmed SSE streams. Public profile/open-mic/event reads are already implemented and need contract coverage rather than redevelopment.
3. Align API contracts and implementation details: error codes/details, pagination, short event identifiers, canonical handles, public visibility filtering, friendly validation details, profile phone storage and privacy, `Accept-Language`, quota headers, current-profile headers, and response serialization. Run OpenAPI validation and API tests after every contract change.
4. Implement the production authentication boundary: Cognito JWT verification in the API, Amplify/Cognito environment configuration, redirect URI configuration, account provisioning, refresh behavior, logout, and deterministic local identities for tests. Do not expose organizer UI until permission responses are real.
5. Define and implement the account preference contract for locale, selected theme, and color mode. Use local storage for anonymous users, then synchronize authenticated preferences through the account API with account preference taking precedence across devices.
6. Add profile contact storage for phone numbers, including migration, validation/normalization policy, ownership controls, OpenAPI fields, serializer behavior, privacy rules, local seed fixtures, and profile editor support. Authenticated performer registration should use the stored profile phone/city where appropriate and must not ask for duplicate values.
7. Define API adapter boundaries for SES email, S3/Amplify Storage, and any SSE infrastructure. Provide local fakes and deterministic test adapters; keep AWS implementation details out of feature components.
8. Extend the existing repeatable local integration data: Docker Postgres/PostGIS, migrations, and development seed data already cover public/private profiles, active/paused/draft series, upcoming/closed events, registrations, performances, handles, and test accounts. Add permissions, profile phone fixtures, media, authenticated users, and token lifecycle fixtures.
9. Define infrastructure ownership: Amplify manages frontend-adjacent resources such as Cognito, frontend hosting, and storage resources it owns; Terraform manages independently owned API/platform resources. No AWS resource may be managed by both.
10. Record the browser boundary: CloudFront/Amplify serves the SPA independently; the API remains JSON/API-only with a generic non-API entry point; no API-rendered metadata or entity-specific HTML.
11. Keep MSW/local fixtures for isolated component tests only. Do not use mocks to conceal missing production API operations or to mark a feature complete.

### Phase 1: Visual direction and design system
12. **Implemented:** prototype gallery with six paired light/dark families, now named House Lights, Day Set, Tonal Key, Soundcheck, Soft Focus, and Blue Note. Continue by reviewing them on organizer screens and recording the selection decision.
13. Record palette provenance, source/licensing notes, transformations, intended domain fit, and contrast tradeoffs. Prefer established systems such as Material 3, Radix Colors, Open Color, Solarized, Nord, and IBM Carbon over arbitrary hex values.
14. Evaluate every theme in light and dark modes against public browsing, organizer operations, mobile registration, focus/hover/disabled/error/success states, multilingual expansion, high contrast, and low-glare use.
15. **Partially implemented:** CSS-variable theme contracts, persisted selection, and system light/dark preference exist. Add contrast automation, formal theme provenance, and account synchronization once the preference API from Phase 0 is available.
16. Select a default only after side-by-side review; keep at least two production-ready alternatives without component rewrites. Define content voice and ensure every visible string comes from i18n resources.
17. **Partially implemented:** semantic controls, visible focus, reduced motion, live status messaging, and icon affordances exist. Add the Radix primitive layer, automated accessibility checks, skeleton primitives, banners, and tooltips.

### Phase 2: Frontend foundation and real API integration
18. **Implemented in part:** `apps/web`, `api`, `auth`, `features`, theme, i18n, and query foundations exist. Add the remaining architecture folders and formal route/feature boundaries.
19. **Partially implemented:** root providers, lazy Amplify session adapter, API client, query client, error mapping, and local API proxy exist. Add one-401 refresh, generated OpenAPI types, quota/current-profile state, and authenticated preference synchronization.
20. **Partially implemented:** app shell, responsive navigation, theme controls, error/loading states, and live status messaging exist. Add route error boundaries, toasts, permission-aware navigation, and account/profile switching.
21. **Partially implemented:** English i18n seed, locale header support, query freshness, and local backend proxy exist. Add lazy namespaces, locale resolution, `<html lang>`, MSW, and locale expansion tests.
22. **Partially implemented:** initial bundle budget and reduced-motion styles exist. Add TanStack Router route splitting, hover prefetch, focus/scroll restoration, and formal budget checks.

### Phase 3: Public browsing
23. **Implemented in part:** seeded upcoming events, open-mic directory, radius API support, loading/error/empty states, and mobile-first cards exist. Add frontend filters/search and dedicated directory route composition.
24. **Implemented in part:** event, open-mic, profile, registration, UUID-compatible, short-code, and detail routes exist. Add vanity handle routes, nested event routes, canonical redirects, and TanStack Router loaders.
25. **Partially implemented:** disabled reaction/follow/comment affordances exist on public cards and detail views. Add consistent placement across all surfaces and future comment/review components.
26. **Implemented in part:** shared cards, detail facts, registration state, capacity/error messaging, and social placeholders exist. Add share/referral controls, media slots, accessibility primitives, and localized formatters.
27. Add remaining interaction polish: page-load reveals, route transitions, hover/focus affordances, sticky mobile actions, skeleton transitions, offline/retry states, and reduced-motion equivalents.

### Phase 4: Registration and identity flows
28. **Implemented in part:** guest registration, optional city/phone/song fields, media consent, validation, duplicate/capacity/closed-registration errors, short-code routes, confirmation state, and friendly messages exist. Add localized formatting, referral attribution, and automated tests.
29. Implement authenticated performer registration using the completed Amplify account/profile APIs. Keep organizer and performer profiles distinct and support inline performer-profile creation where the API permits it.
30. Implement email verification and magic-link flows: consume URL tokens once, call the API exchange endpoint, remove raw tokens from the URL, rely on the HttpOnly edit session, and never store raw tokens in client state or analytics.
31. Implement claimable registrations and explicit claim/adoption UX: dashboard banner, dedicated claim route, per-row claim and claim-all actions, profile adoption selection, conflict recovery, and query invalidation. Never auto-claim.
32. Implement the organizer kiosk flow as a mobile/tablet-first, high-contrast workflow with large touch targets, rapid reset, confirmation feedback, keyboard support, and real permission gating.
33. Add provider-neutral registration analytics only after event names and privacy rules are agreed.

### Phase 5: Organizer console
34. Implement authenticated dashboard and current-profile state using the completed account/profile/permission APIs. Add route-loader permission gates with inline 403 states.
35. Implement open-mic create/edit screens with React Hook Form/Zod, location fields, activity/tag selection, registration settings, handle availability, unsaved-change protection, responsive layout, and server error mapping.
36. Implement event create/edit/lifecycle screens with inherited location defaults, date/time-zone handling, capacity and registration closure, activity validation, form feedback, and saved/dirty/error states.
37. Implement roster and performance operations: visibility-safe rows, sequence/status controls, organizer notes, performance editing/deletion, filters, kiosk handoff, and live refresh once the confirmed SSE endpoint exists.
38. Implement organizer media after the media API and storage adapters are complete: upload progress, photo/video-link forms, captions/alt text, permissions, soft-delete/recovery, and failure/retry states.
39. Add operational motion: save-state transitions, inline validation reveal, toast confirmations, roster reorder feedback, modal focus transitions, and no-motion equivalents.

### Phase 6: Quality, accessibility, and delivery
40. Add unit tests for formatters, theme selection, locale resolution, referral persistence, auth state transitions, permission decisions, route helpers, and API error mapping.
41. Add RTL/MSW integration tests for public reads, registration, verification, claim/adoption, organizer forms, kiosk reset, loading/error/empty states, theme switching, and multilingual expansion.
42. Add Playwright tests for mobile and desktop browsing, guest/authenticated registration, magic-link exchange, organizer setup, roster operation, and media upload. Include keyboard-only and reduced-motion checks.
43. Run automated accessibility and manual keyboard/focus/contrast review at mobile, tablet, and desktop widths, including translated string expansion and touch targets.
44. Measure Web Vitals and bundle budgets on throttled mobile profiles; enforce FCP/LCP/TTI/CLS, transition, and initial-JS targets in CI.
45. Configure Amplify frontend deployment, static asset hashing, SPA fallback, environment separation, preview environments, cache headers, and smoke tests. Keep Terraform validation for independently owned platform infrastructure.
46. Add frontend commands to the root CI-equivalent workflow and document local setup, Amplify configuration, API URLs, seed data, MSW, Playwright, locales, themes, and remaining backend boundaries.

**Relevant files**
- `apps/web/` — new frontend workspace and all SPA implementation.
- `openapi.yaml` — authoritative API contract and source for generated frontend types.
- `apps/api/src/spa-routes.ts` — generic API-side SPA entry-point fallback; keep it independent of route/entity rendering.
- `apps/api/src/` — backend operations the frontend depends on, especially auth/account/profile/current-profile/permissions, public reads, registrations, performances, and media.
- `docs/5-open-mic-frontend-architecture.md` — frontend stack, route map, state, i18n, accessibility, performance, deployment, and testing conventions.
- `docs/3-open-mic-requirements.md` — product behavior, roles, registration, public visibility, and Phase 1 boundaries.
- `docs/6-open-mic-vanity-urls.md` — canonical handle paths, casing, redirects, registration links, and public visibility.
- `docs/architecture/api-design.md` and `docs/architecture/infrastructure.md` — JSON/API boundary, CloudFront/S3 deployment, and auth/storage integration constraints.
- `docs/decisions.md` and `docs/concerns.md` — settled provenance/claim rules and unresolved consent/security/retention decisions.
- `package.json`, `tsconfig.json`, and root CI scripts — add workspace/build/test/typecheck/lint commands without disrupting API checks.
- `apps/api/migrations/`, `scripts/seed-dev.mjs`, `.env.example`, and Amplify environment configuration — provide repeatable backend fixtures and environment wiring before frontend feature work.

**Verification**
1. Complete Phase 0's contract-gap matrix and backend readiness checklist before marking any dependent frontend route complete.
2. Validate the theme gallery in mobile, tablet, and desktop viewports; review focus visibility, WCAG AA contrast, reduced motion, long copy, light/dark readability, source provenance, and alternate-theme behavior before implementing full screens.
3. Run frontend typecheck, lint/format checks, unit tests, RTL/MSW integration tests, Playwright E2E, accessibility checks, and production Vite build.
4. Run API `npm test`, OpenAPI validation, link checks, and frontend contract coverage together for every cross-boundary change.
5. Test the built SPA behind a static server/CloudFront-like fallback: every non-API route returns the same entry point, every `/api/*` request remains JSON, assets resolve with hashed URLs, and deep links reload correctly.
6. Measure bundle and Web Vitals budgets on throttled mobile profiles; fail CI on route chunk regressions or accessibility violations in the selected critical flows.
7. Verify the complete Amplify/Cognito staging flow, API JWT verification, SES/S3 adapter behavior, local seeded flow, and deployment ownership before production rollout. Keep Terraform validation limited to independently owned platform infrastructure.

**Decisions**
- Authentication: use AWS Amplify/Cognito from the initial frontend architecture, but isolate it behind `auth/` so tests and local development can inject deterministic identities.
- Initial frontend milestone: public browsing, guest/authenticated registration, organizer console, and organizer media, but only after their Phase 0 API/auth/storage contracts are complete.
- Deployment: CloudFront/S3 serves the SPA independently; the API does not render entity-specific HTML or metadata.
- Visual direction: prototype a generous gallery of source-informed light/dark theme families before choosing a default; keep at least two polished alternatives and record palette provenance, transformations, licensing notes, and contrast results.
- Localization: English is bundled first; all UI strings are translatable and locale loading is namespace-based.
- Accessibility: WCAG AA contrast, keyboard access, visible focus, semantic HTML, Radix primitives, screen-reader labels/live regions, and reduced-motion support are release requirements.
- Scope exclusions: performer-authored media, reviews, comments, reactions, follows, messaging, suggestions, notifications beyond any confirmed API stream, advanced maps/discovery, and account deletion/export UI remain out of the first frontend milestone unless the API contract is explicitly expanded. Their UI affordances are still part of the information architecture: they render as clearly unavailable or coming soon, with accessible labels and no misleading interaction.
- API gaps are resolved in Phase 0 before dependent screens are treated as complete; mocks cannot silently become production behavior.

**Further Considerations**
1. The frontend architecture contains both Amplify and direct Cognito references; Phase 0 must reconcile them and make Amplify the single frontend infrastructure owner.
2. Account/profile/permission, media, email, storage, and SSE operations must be present in the executable API contract before their frontend surfaces leave placeholder state.
3. The entry-point HTML remains intentionally minimal until the SPA shell is finalized; asset paths, metadata, and CloudFront/Amplify fallback behavior should be defined with the frontend deployment configuration.
