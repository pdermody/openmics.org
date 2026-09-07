## Plan: Build The Frontend SPA

TL;DR: Create `apps/web` as a React 18 + TypeScript + Vite SPA that consumes the existing Fastify JSON API, starts with a source-informed light/dark theme gallery, and ships public browsing, registration, and organizer workflows as responsive, accessible, multilingual-ready experiences. Use Amplify/Cognito from the start behind a small auth boundary, keep CloudFront/S3 as the frontend deployment boundary, and leave the API responsible only for JSON plus a generic SPA entry-point fallback.

**Steps**

### Phase 0: Contract and product alignment
1. Inventory the executable API contract against the frontend route map before building screens. Confirm response shapes, error envelopes, pagination, visibility states, auth requirements, and missing operations such as account/auth profile, current-profile, permissions, registration token exchange, media, and any SSE endpoints.
2. Define the frontend API boundary in `apps/web/src/api/client.ts`: base URL, `Accept-Language`, bearer token attachment, one 401 refresh attempt through Amplify, JSON error-envelope parsing, quota headers, request cancellation, and typed operation wrappers generated from `openapi.yaml`.
3. Record frontend-specific decisions: CloudFront/S3 serves the SPA independently; the API remains JSON/API-only with a generic non-API entry point; no API-rendered metadata or entity-specific HTML; public vanity route data loads through API queries.
4. Keep missing backend operations as explicit integration tasks rather than hiding gaps in mock data. Use MSW/local fixtures only for development and component tests.

### Phase 1: Visual direction and design system
5. Research and prototype a generous theme gallery rather than only 2-3 isolated mockups. Start with at least 6 paired light/dark families, each represented by the same compact set of public and organizer screens: warm editorial music venue, bright civic directory, Material 3 tonal color, Radix Colors neutral/accent, Solarized-inspired, and Nord-inspired. Treat these as design references rather than copying product branding.
6. Record the provenance and rationale for every palette: source system or published palette, license/usage notes where relevant, transformations made for this product, intended emotional/domain fit, and known contrast tradeoffs. Prefer established systems such as Material 3, Radix Colors, Open Color, Solarized, Nord, and IBM Carbon as references over arbitrary hand-picked hex values.
7. Evaluate every theme family in both light and dark modes against public browsing, dense organizer operations, mobile registration, focus/hover/disabled/error/success states, chart or map accents if later introduced, and multilingual text expansion. Include at least one intentionally high-contrast option and one restrained low-glare option.
8. Define interchangeable theme contracts rather than hard-coding colors in components. Implement the gallery as CSS-variable/token configurations behind a theme provider, with semantic roles such as surface, text, muted text, border, accent, accent-contrast, success, warning, danger, focus, and scrim. Theme selection must persist locally and respect the system light/dark preference.
9. Select a default theme only after side-by-side review using representative screens and a short decision record. Keep at least two additional production-ready alternatives available; selecting a default must not require component rewrites. Avoid purple-default or generic dashboard styling.
10. Establish content voice and reusable copy patterns: concise labels, registration reassurance, organizer operational language, verification/magic-link explanations, capacity/closure messaging, empty states, loading/error recovery, and localized plural/date/currency formatting. Every visible string must come from i18n resources.
11. Build accessible primitives with Radix where applicable: buttons, links, form fields, dialogs, menus, tabs, comboboxes, toasts, confirmation flows, skeletons, banners, and live-region announcements. Use lucide icons with tooltips for unfamiliar icon-only actions.
### Phase 2: Frontend foundation
12. Create the application shape from the frontend architecture: `shell`, `auth`, `api`, `routes`, `features`, `components`, `i18n`, `locales`, and `styles`. Keep route composition in `routes`; domain queries/mutations and feature components stay under `features`.
13. Implement `main.tsx`, root providers, app shell, error boundaries, route pending/error boundaries, responsive navigation, profile switcher placeholder, language switcher, quota banner, toast/live-region system, and theme persistence.
14. Configure i18n with English bundled initially, lazy namespaces, locale resolution from account preference/local storage/browser, `<html lang>` updates, native language names, and `Accept-Language` on API calls. Define the locale manifest so adding Gaeilge or French does not require application-code changes.
15. Configure TanStack Query with 60-second list/detail freshness defaults from the architecture, centralized query keys, mutation invalidation, local skeletons per data island, optimistic updates only where behavior is safe, and an MSW-backed development/test API.
16. Add route-level and role-level code splitting, hover prefetch with TanStack Router, responsive image/media loading, reduced-motion handling, focus restoration, scroll restoration, and a bundle budget with an initial-route gzip target of 100 KB.

### Phase 3: Public browsing
17. Implement the public home/directory experience using real API calls: upcoming events, active open-mic directory, filter/search controls, location radius search, empty/loading/error states, and mobile-first cards/list views. Make scan/comparison efficient on desktop without turning the page into nested cards.
18. Implement public profile, open-mic, event, and registration entry routes, including canonical vanity route composition (`/@:handle`, nested event paths, durable registration links), UUID fallback handling, visibility-safe 404 states, and query-driven route loaders.
19. Define a consistent social-affordance contract for every open-mic and event surface, and later for comment/review components: reaction, follow, and comment buttons appear in predictable locations on cards, detail pages, review/comment items, and relevant organizer/public views. Use real disabled or coming-soon states until the corresponding API operations exist; do not create fake counts, pretend mutations succeeded, or imply that unavailable actions are active.
20. Implement shared public components: event/open-mic cards, profile headers, venue/location display, schedule/date formatting, registration state, capacity/closure messaging, reaction/follow/comment affordance slots, share/copy-link controls, referral capture and URL cleanup, and accessible responsive layouts.
21. Add meaningful interaction polish: staggered page-load reveals, restrained route transitions, hover/focus affordances, sticky/mobile registration actions where appropriate, scroll-aware headers, skeleton-to-content transitions, and explicit offline/network retry states. Respect `prefers-reduced-motion`.
20. Add meaningful interaction polish: staggered page-load reveals, restrained route transitions, hover/focus affordances, sticky/mobile registration actions where appropriate, scroll-aware headers, skeleton-to-content transitions, and explicit offline/network retry states. Respect `prefers-reduced-motion`.

### Phase 4: Registration and identity flows
21. Implement guest registration with minimal fields, explicit consent copy, validation, duplicate/capacity/closed-registration errors, confirmation state, and localized date/time/currency messaging.
22. Implement authenticated performer registration using Amplify account state and an account-owned performer-profile selector. Keep organizer and performer profiles distinct; offer inline performer-profile creation only once the corresponding API operation exists.
23. Implement email verification and magic-link flows: consume URL tokens once, call the API exchange endpoint, remove raw tokens from the visible URL, rely on the HttpOnly edit session, and never store tokens in React/Zustand/query state or analytics.
24. Implement claimable registrations and explicit claim/adoption UX: dashboard banner, dedicated claim route, per-row claim and claim-all actions, profile adoption selection, success/error recovery, and query invalidation. Never auto-claim.
25. Implement the organizer kiosk registration flow as a mobile/tablet-first, high-contrast, low-distraction workflow with large touch targets, rapid reset, clear confirmation feedback, keyboard support, and organizer-only permission gating.
26. Add registration-specific analytics hooks as provider-neutral events only after the event names and privacy rules are agreed; keep external analytics deferred by default.

### Phase 5: Organizer console
27. Implement authenticated dashboard and current-profile state using Amplify identity plus the API account/profile operations. Add route-loader permission gates that render inline 403 states and never treat UI checks as security.
28. Implement open-mic create/edit screens with React Hook Form/Zod, location fields, activity/tag selection, registration settings, handle availability, unsaved-change protection, responsive layout, and server error mapping.
29. Implement event create/edit/lifecycle screens with inherited location defaults, date/time-zone handling, capacity and registration closure, activity validation, form feedback, and clear dirty/saved/error states.
30. Implement roster and performance operations: organizer roster view, visibility-safe registration rows, sequence/status controls, organizer notes, performance editing/deletion, filters, mobile kiosk handoff, and live refresh boundaries once an SSE endpoint exists.
31. Implement organizer media surfaces only after the media API contract is confirmed: upload progress, photo/video-link forms, captions/alt text, organizer permissions, soft-delete/recovery, and media failure/retry states.
32. Add subtle but useful operational motion: save-state transitions, inline validation reveal, toast confirmations, roster reorder feedback, modal focus transitions, and no-motion equivalents.

### Phase 6: Quality, accessibility, and delivery
33. Add unit tests for formatters, theme selection, locale resolution, referral persistence, auth state transitions, permission decisions, route helpers, and API error mapping.
34. Add React Testing Library/MSW integration tests for public reads, registration, verification, claim/adoption, organizer forms, kiosk reset, loading/error/empty states, theme switching, and multilingual expansion.
35. Add Playwright tests for mobile and desktop public browsing, guest registration, authenticated registration, magic-link exchange, organizer event setup, roster operation, and media upload once available. Include keyboard-only flows and reduced-motion checks.
36. Run automated accessibility checks plus manual keyboard/focus/contrast review at mobile, tablet, and desktop widths. Verify long translated strings, empty states, touch targets, no text overlap, and screen-reader labels/live regions.
37. Measure performance on throttled 3G/mobile profiles: FCP <1.5s, LCP <2.5s, TTI <3.0s, CLS <0.05, warm transitions <100ms, cold transitions <400ms, and initial JS <=100 KB gzip. Enforce route chunk budgets in CI.
38. Configure Vite production build, static asset hashing, SPA fallback behavior, environment separation, CloudFront/S3 deployment documentation, preview environments, cache headers, and smoke tests. Keep Terraform separate until the frontend shell and deployment contract are stable.
39. Add frontend scripts to the root CI-equivalent command and document local setup, Amplify environment configuration, API base URLs, MSW usage, Playwright prerequisites, supported locales, theme extension, and known backend contract gaps.

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

**Verification**
1. Before implementation, produce a contract-gap matrix mapping every selected frontend route to its API operation, response schema, auth requirement, loading/error/empty state, and test fixture.
2. Validate the theme gallery in mobile, tablet, and desktop viewports; review focus visibility, WCAG AA contrast, reduced motion, long copy, light/dark readability, source provenance, and alternate-theme behavior before implementing full screens.
3. Run frontend typecheck, lint/format checks, unit tests, RTL/MSW integration tests, Playwright E2E, accessibility checks, and production Vite build.
4. Run API `npm test`, OpenAPI validation, link checks, and frontend contract coverage together for every cross-boundary change.
5. Test the built SPA behind a static server/CloudFront-like fallback: every non-API route returns the same entry point, every `/api/*` request remains JSON, assets resolve with hashed URLs, and deep links reload correctly.
6. Measure bundle and Web Vitals budgets on throttled mobile profiles; fail CI on route chunk regressions or accessibility violations in the selected critical flows.
7. Verify Amplify/Cognito in a staging environment only after local/MSW flows are stable; keep production AWS/Terraform validation as a separate deployment phase.

**Decisions**
- Authentication: use AWS Amplify/Cognito from the initial frontend architecture, but isolate it behind `auth/` so tests and local development can inject deterministic identities.
- Initial frontend milestone: public browsing, guest/authenticated registration, and organizer console; media is a follow-on within the same frontend architecture after its API contract is ready.
- Deployment: CloudFront/S3 serves the SPA independently; the API does not render entity-specific HTML or metadata.
- Visual direction: prototype a generous gallery of source-informed light/dark theme families before choosing a default; keep at least two polished alternatives and record palette provenance, transformations, licensing notes, and contrast results.
- Localization: English is bundled first; all UI strings are translatable and locale loading is namespace-based.
- Accessibility: WCAG AA contrast, keyboard access, visible focus, semantic HTML, Radix primitives, screen-reader labels/live regions, and reduced-motion support are release requirements.
- Scope exclusions: performer-authored media, reviews, comments, reactions, follows, messaging, suggestions, notifications beyond any confirmed API stream, advanced maps/discovery, and account deletion/export UI remain out of the first frontend milestone unless the API contract is explicitly expanded. Their UI affordances are still part of the information architecture: they render as clearly unavailable or coming soon, with accessible labels and no misleading interaction.
- API gaps are surfaced and resolved before dependent screens are treated as complete; mocks cannot silently become production behavior.

**Further Considerations**
1. The frontend document specifies both Amplify and direct Cognito patterns in different places. This plan chooses Amplify because that was selected for the initial implementation; reconcile the docs before coding.
2. The current API contract does not yet expose every frontend dependency, especially account/auth profile, current-profile, permissions, media, and SSE operations. These should be tracked as explicit backend contract work in Phase 0.
3. The entry-point HTML remains intentionally minimal until the SPA shell is designed; asset paths, metadata, and CloudFront fallback behavior should be finalized with the first frontend build rather than guessed now.
