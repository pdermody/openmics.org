# Open Mic Frontend Architecture

**Status:** Draft
**Date:** 2026-08-21
**Related:** [4-open-mic-technical-architecture.md](4-open-mic-technical-architecture.md)

---

## 1) Summary

A **React 18 + TypeScript + Vite** single-page application, hosted as static assets on S3, fed by the Fastify API described in the [technical architecture](4-open-mic-technical-architecture.md#5-api-architecture). The frontend is designed around four fixed priorities:

1. **Instant navigations** after the first paint (client-side routing + prefetch on hover).
2. **Data-driven pages feel fast** via stale-while-revalidate (60 s freshness is acceptable).
3. **Code splitting** by route and by role, so an organizer never downloads the performer profile editor and vice versa.
4. **Real-time SSE updates** keep the client cache coherent without polling.

Media (images, videos) is loaded directly from `media.openmics.org` (S3-backed) and from embedded video platforms; a media CDN can be added later without frontend changes.

**Phase 1 product boundary:** the frontend prioritizes organizer console routes, event creation and operation, guest and authenticated registration, and public read-only pages. Organizer-owned photos and video links are supported. Performer uploads, comments, reviews, reactions, private messaging, follows, and social feeds are later-phase routes and controls, even if their architectural extension points are described below.

**Framework decision rationale** and the comparison against Astro and Next.js are recorded in commit history; the short answer: for a pure-static S3 deployment with mostly runtime-fetched content, SSR/RSC frameworks pay taxes we don't get to redeem, and Astro's islands model doesn't help when the majority of every page is an island. React + Vite hits every requirement with the deepest ecosystem.

---

## 2) Stack

| Concern | Choice | Notes |
|---|---|---|
| Language | TypeScript (strict) | Shared types with API via a generated `openapi.d.ts` from the canonical [`openapi.yaml`](../openapi.yaml) / Fastify Swagger output. |
| Build | Vite | Fast HMR, native ESM, first-class code splitting. |
| UI framework | React 18 | Suspense, transitions, concurrent features. |
| Routing | **TanStack Router** | Type-safe routes, first-class loaders, hover prefetch, zero-config code splits per route. |
| Server-state | **TanStack Query** | 60 s `staleTime` default; SSE feeds `queryClient.setQueryData`. |
| Client-state | React Context + `useReducer` for auth/current profile; **Zustand** for cross-cutting UI state (notification tray, quota banner). No Redux. |
| Styling | **Tailwind CSS** + **Radix UI** headless primitives. No component library CSS to ship. |
| Forms | **React Hook Form** + **Zod** (schemas shared with API validation). |
| Icons | `lucide-react` (tree-shakeable, tiny). |
| Date/time | `date-fns` (tree-shakeable) or `Temporal` polyfill. |
| i18n | **`react-i18next`** — JSON resource files per locale, per-namespace lazy loading, English fallback; `Intl.*` for date/number/currency formatting. |
| Testing | Vitest + React Testing Library + Playwright (E2E). |
| Analytics | Plausible or PostHog script (deferred, `async`). |

**Bundle target:** ≤ 100 KB gzip for the initial route (React + Router + Query + shell). If we push past that, switch to **Preact + `preact/compat`** as a near drop-in swap (saves ~30–40 KB gzip).

---

## 3) Application Shape

```
apps/web/
├── src/
│   ├── main.tsx                 # bootstrap
│   ├── router.tsx               # TanStack Router tree
│   ├── shell/
│   │   ├── AppShell.tsx         # nav, header, footer, profile switcher, notification tray
│   │   ├── QuotaBanner.tsx      # reads X-Quota-* headers → banner at 80% / 100%
│   │   └── ErrorBoundary.tsx
│   ├── auth/                    # Cognito hosted UI + token refresh
│   ├── api/
│   │   ├── client.ts            # fetch wrapper: adds auth, parses envelope, throws QuotaError etc.
│   │   ├── queryClient.ts       # TanStack Query config (staleTime 60_000)
│   │   ├── keys.ts              # centralized query key factory
│   │   └── sse.ts               # EventSource → queryClient.setQueryData bridge
│   ├── routes/                  # one folder per top-level route family
│   │   ├── (public)/            # home, open-mics list, event/profile detail (SEO-ish paths)
│   │   ├── dashboard/
│   │   ├── organizer/           # role-split bundle
│   │   ├── performer/           # role-split bundle
│   │   ├── suggestions/
│   │   └── settings/
│   ├── features/                # domain features (openMics, events, media, comments, follows…)
│   │   └── <feature>/
│   │       ├── api.ts           # useXxx() query & mutation hooks
│   │       ├── types.ts
│   │       └── components/
│   ├── components/              # cross-cutting UI (Skeleton, Avatar, EventCard, Rating…)
│   ├── i18n/
│   │   ├── index.ts             # i18next init; resolves the initial locale
│   │   ├── supported.ts         # supported locales manifest (BCP 47 tag + native name)
│   │   └── resolve.ts           # resolution order: account pref → localStorage → navigator → 'en'
│   ├── locales/
│   │   ├── en/                  # bundled with the shell (default fallback)
│   │   │   ├── common.json
│   │   │   ├── directory.json
│   │   │   ├── dashboard.json
│   │   │   ├── openMic.json
│   │   │   ├── event.json
│   │   │   └── errors.json
│   │   └── <lang>/…             # dynamically imported on demand
│   └── styles/
├── index.html
├── vite.config.ts
├── tailwind.config.ts
└── tsconfig.json
```

Rationale for the split:
- **routes/** owns URL structure and layout composition.
- **features/** owns domain logic (queries, mutations, types) and is independent of routing.
- Route files import from features but not vice versa.

---

## 4) Routing and Code Splitting

### Route splitting

TanStack Router splits every route into its own chunk by convention. `main.tsx` only loads the shell and the initial matched route.

### Create and edit routes

Create and edit flows are **distinct routes**, not modals or query flags:

- Create: `/<resource>/new` (e.g. `/open-mics/new`, `/profiles/new`, `/open-mics/:id/events/new`)
- Edit: `/<resource>/:id/edit` (e.g. `/open-mics/:id/edit`, `/profiles/:id/edit`, `/open-mics/:id/events/:eventId/edit`)

Why distinct routes over modals:
- Every editor is deep-linkable and back-button friendly.
- Each editor is its own chunk — a viewer never downloads the editor bundle.
- Permission checks happen in the route loader, so an unauthorized user hits a 403 boundary instead of rendering a half-loaded modal.
- The dirty-form guard is a route `beforeLoad` hook rather than a modal `onOpenChange` hack.

The canonical URL map lives in the technical architecture's [Key Pages](4-open-mic-technical-architecture.md#6-frontend-architecture) list; this document treats that list as the source of truth for URL structure.

### Role-based splitting

Users can act as different profile types; the organizer console, performer profile editor, and platform-admin console are disjoint experiences.

```ts
// routes/dashboard/route.tsx
export const Route = createFileRoute('/dashboard')({
  component: DashboardShell,
});

// A logged-in user sees the shell + one of these depending on their current profile's roles:
const OrganizerConsole = lazy(() => import('@/routes/organizer/Console'));
const PerformerConsole = lazy(() => import('@/routes/performer/Console'));
const AdminConsole     = lazy(() => import('@/routes/admin/Console'));

function DashboardShell() {
  const { hasRole } = useCurrentProfile();
  return (
    <Suspense fallback={<DashboardSkeleton />}>
      {hasRole('platform_admin') && <AdminConsole />}
      {hasRole('organizer')      && <OrganizerConsole />}
      {hasRole('performer')      && <PerformerConsole />}
    </Suspense>
  );
}
```

A performer never downloads the organizer bundle. A profile switch triggers the appropriate lazy import.

### Prefetch on hover

TanStack Router supports `preload="intent"` on `<Link>`. On pointer/focus the target route's code chunk and its loader data are fetched. Combined with our 60 s `staleTime`, most navigations are already warm before the click.

```tsx
<Link to="/open-mics/$slug" params={{ slug }} preload="intent">
  {name}
</Link>
```

For non-router prefetches (e.g., hovering a card that opens a modal), use:

```ts
queryClient.prefetchQuery(eventKeys.detail(id));
```

---

## 5) Data Fetching (TanStack Query)

**Global defaults**

```ts
new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 60_000,          // 1 minute — matches product tolerance
      gcTime: 5 * 60_000,         // keep in cache for 5 min after unmount
      retry: 1,
      refetchOnWindowFocus: false,
      refetchOnReconnect: true,
    },
    mutations: {
      onError: standardMutationErrorHandler,  // handles QUOTA_EXCEEDED, VALIDATION_ERROR, etc.
    },
  },
});
```

**Query key factory** — a single `keys.ts` file to avoid stringly-typed keys sprawling across features:

```ts
export const eventKeys = {
  all: ['events'] as const,
  detail: (id: string) => [...eventKeys.all, id] as const,
  registrations: (id: string) => [...eventKeys.detail(id), 'registrations'] as const,
};
```

**Mutations use optimistic updates** where sensible (reactions, follows, comment posts, RSVPs). On server confirm, we merge the canonical row into the cache; on failure, we roll back and show a toast.

**Freshness rules** (product-facing, not technical):
- Lists (open mics, events, profiles): 60 s.
- Detail pages: 30 s (they're the "focused" surface).
- Notification unread count: 5 s or SSE-driven (see below).
- Current profile / permissions: cached until logout or explicit switch.

---

## 6) Real-Time (SSE) Integration

The API exposes `GET /api/notifications/stream` and event-scoped streams. A single hook wires SSE messages into the query cache; no component polls.

```ts
// src/api/sse.ts
export function useSseSubscription() {
  const qc = useQueryClient();
  useEffect(() => {
    const es = new EventSource('/api/notifications/stream', { withCredentials: true });

    es.addEventListener('notification', (ev) => {
      const n = JSON.parse((ev as MessageEvent).data);
      qc.setQueryData(notificationKeys.list(), (old = []) => [n, ...old]);
      qc.setQueryData(notificationKeys.unreadCount(), (c = 0) => c + 1);
    });

    es.addEventListener('event.updated', (ev) => {
      const e = JSON.parse((ev as MessageEvent).data);
      qc.setQueryData(eventKeys.detail(e.id), e);
    });

    es.addEventListener('registration.added', (ev) => {
      const r = JSON.parse((ev as MessageEvent).data);
      qc.invalidateQueries({ queryKey: eventKeys.registrations(r.eventId) });
    });

    es.onerror = () => scheduleReconnectWithBackoff(es);
    return () => es.close();
  }, [qc]);
}
```

Points to enforce in review:
- The hook is mounted **once** in `AppShell` for the account-level stream.
- Component-scoped SSE (e.g., a live "event running" indicator on an open event page) mounts a **separate** EventSource in that route and closes it on unmount.
- Reconnect uses exponential backoff, capped at 30 s.
- We never mix SSE-driven updates with polling for the same key.

---

## 7) Skeleton Screens

Skeletons replace spinners on every data-driven surface. A tiny primitive set:

```tsx
<Skeleton kind="card" />          // event card
<Skeleton kind="avatar" />        // profile picture
<Skeleton kind="text" lines={2} /> // paragraph placeholder
<Skeleton kind="row" count={5} />  // list rows
```

Pattern per page:
1. Render the page shell (layout, nav, page title) immediately.
2. Render skeletons for each data island — do **not** wait for a global loading state.
3. When a query resolves, swap that section's skeleton for real content.

React Suspense boundaries provide the fallback; TanStack Query's `useSuspenseQuery` lets us keep skeleton wiring local per island.

---

## 8) Authentication

- **AWS Cognito hosted UI** for sign-up / sign-in / password reset.
- On return, tokens are stored in `sessionStorage` (or memory + secure httpOnly refresh cookie once we add a small BFF later).
- `api/client.ts` attaches the ID token as `Authorization: Bearer`, refreshes silently on 401.
- The **current profile** is a separate concept from the account: `PUT /accounts/:id/current-profile` returns the new profile envelope; the client stores it in the auth context and includes `X-Current-Profile: <uuid>` on requests where the server distinguishes.
- **Share button and referral capture:** a reusable `<ShareButton>` renders on event detail, event register, open-mic detail, and profile pages, using the Web Share API with a "Copy link" fallback. When the current user has a signed-in profile it shares `<canonical-url>?ref=<currentProfileId>`; otherwise (anonymous, or no current profile) it shares the plain canonical URL with no `ref` param. On load of any of those page types, the client reads `?ref=` if present, stores it in `localStorage['openmic:ref']` with a 30-day expiry, and strips it from the visible URL. The stored value is attached directly to the next registration submission (`Registrations.referred_by_profile_id`). When the visitor starts Cognito sign-up, the client instead places it in the signed, single-use OAuth `state` value bound to that login attempt; Fastify validates and consumes it while creating the application account. An expired, missing, or unrecognized value is simply never sent — it never blocks browsing, registration, or sign-up.
- Profile switch invalidates permission-scoped queries (`profiles`, `dashboard`, notifications counter) but preserves account-scoped data (settings, plan).
- **Account lifecycle and privacy controls:** the account settings surface includes a dedicated **Delete account** flow, a **Download data export** action, and a clear retention notice stating the 30-day recovery window and final purge behavior. Deleting an account immediately disables sign-in and blocks account-scoped writes; public attribution is replaced with a neutral "deleted account" or "former member" label for historical content, while immutable system records remain retained under anonymized references. The UI also includes the account recovery and reactivation path if the platform supports it during the grace period.
- **User-initiated guest registration claim:** the client queries `GET /me/claimable-registrations` on sign-in, on profile switch, and whenever the "Events I've been in" list is viewed. The result feeds three surfaces: a dashboard banner ("N past registrations look like yours — review and claim"), per-row badges on the "Events I've been in" list, and a dedicated `/claim-registrations` route that lists all matches with per-row **Claim** and **Claim all** actions calling `POST /registrations/:id/claim`. On success we invalidate `myRegistrationsKeys` (so the claimed row shows in "My registrations") and `claimableRegistrationsKeys` (so the banner and badges clear). Nothing is ever auto-claimed; the user has to confirm.
- **Self-serve guest registration with email confirmation:** the `/events/:eventId/register` route lets an unauthenticated visitor submit `performer_name` + required `contact_email`. On submit the client shows a "check your inbox to confirm" state and the row does not yet appear on the public roster. The confirmation email links to `/events/:eventId/register/verify?token=<token>`, which calls `POST /registrations/:id/verify-email` and, on success, transitions to the standard post-registration view (magic edit-link, add-to-calendar, etc.). If the visitor later signs in with the same email, the confirmed row shows up in their claimable list. This same page and rule apply whether the visitor arrived by organic browsing, a shared link, an email reminder, a social ad, or a poster QR code.
- **Kiosk walk-in email nudge:** the `/events/:eventId/collect` kiosk still sends a verification email when a walk-in supplies `contact_email`, but never blocks on it — the row is visible immediately. The confirmation copy explains the one concrete benefit of verifying: only a confirmed email lets the performer later find and claim this exact attendance from their own account.
- **Authenticated self-registration:** a signed-in caller must choose a separate account-owned profile with `profile_kind='performer'`. Organizers registering for their own events must create and select a performer profile; the organizer profile itself cannot be used as the performer identity. Organizer permissions never bypass capacity, ordering, visibility, or verification rules. If no performer profile exists, the form offers inline performer-profile creation and then selects the new profile for the registration.
- **Smart "next event" link and QR code:** the organizer console's event and open-mic pages expose **Copy link** and **Download QR code** for two link types: the event-specific `/events/:eventId/register` and the durable series-level `/open-mics/:id/register` (`/@:handle/register`), which always resolves to whichever event is next scheduled. Both are shared through the same `<ShareButton>` described above, so referral attribution is handled identically.
- **Magic-link registration edit:** the `/events/:eventId/register` route accepts an optional `?token=<edit_token>` search param. The server exchanges it for a short-lived HttpOnly edit session, returns `Cache-Control: no-store` and `Referrer-Policy: no-referrer`, and redirects or renders with the token removed. The client then calls `GET /api/registrations/edit` and uses the edit-session cookie for subsequent `GET`/`PUT` requests; the raw token is never retained in client state or reused for the `PUT`.

### Permission-driven UI

The API is the sole authorization boundary (see the server-side design under [§4 Data Model → Permission enforcement design](4-open-mic-technical-architecture.md#4-data-model-key-entities) in the technical architecture). The frontend mirrors the model to shape UI, never to enforce security.

- **One canonical permissions query per (account, profile).** A key factory `permissionKeys.forProfile(id)` backs `useMyPermissions(profileId)`, which fetches `GET /me/permissions?profile=<id>` once per session with `staleTime: Infinity`. Explicit invalidation replaces time-based refresh.
- **Piggyback on every response.** `api/client.ts` reads the `X-Current-Profile-Permissions` header emitted by successful mutations and detail responses and calls `queryClient.setQueryData(permissionKeys.forProfile(id), …)`. No extra round trip after role changes made via the app itself.
- **Type-safe permission keys.** The `PermissionKey` string-literal union is generated from Fastify's OpenAPI export into `openapi.d.ts`, so a component that asks for a permission that doesn't exist fails at build time.
- **Route loader is the hard gate.** Every editor route calls `context.queryClient.ensureQueryData(permissionKeys.forProfile(id))` in `beforeLoad` and throws a typed `PermissionError` if the required key is missing. The error boundary renders a 403 panel; the editor bundle and its loader data are **never** fetched for unauthorized users. This is the same route-level guard called out in [§3.3](#create-and-edit-routes).
- **Component is the soft gate.** A `useHasPermission(key)` hook and a `<Show when={…}>` primitive hide affordances the caller can't use. Hidden UI is UX only — it is not a security boundary; a savvy user hitting the endpoint directly still gets a 403 from the API.
- **Profile switch and SSE invalidation.** Switching profiles invalidates `permissionKeys.forProfile(previous)` and prefetches the new profile's set. A `permissions.invalidated` SSE event (fired when an admin edits the caller's roles) also calls `invalidateQueries` on the same key; UI degrades in place without a reload.
- **No redirect on permission failure.** A 403 renders inline (with a "request access" affordance where applicable). Redirecting on 403 authenticates existence, and can loop when the post-login landing page is itself the denied page.

---

## 9) Errors and Quotas

All API errors use the envelope defined in the [technical architecture](4-open-mic-technical-architecture.md#5-api-architecture). The client wrapper parses `error.code` into typed classes:

- `ValidationError` — surfaced by React Hook Form as field errors.
- `AuthError` — trigger silent token refresh once, then redirect to sign-in.
- `PermissionError` — show inline "you don't have permission" state.
- **`QuotaError`** — throws with `{ dimension, current, limit, upgradeUrl }`. A cross-cutting `QuotaBanner` renders when we're at ≥ 80% for any dimension; on `QUOTA_EXCEEDED` the mutation handler shows a modal with the upgrade CTA.

Every `fetch` response is also inspected for `X-Quota-<Dimension>-Used` / `-Limit` headers. Values are stored in a small Zustand slice so any component (e.g., "Upload photo" button) can gate itself locally without another round trip.

**Moderation:** comments and reviews appear immediately after publication. The UI provides delete controls for authors, media owners where comments target their media, and owning organizers for content in their organization. There is no approval or pending-moderation state; deleting a comment also removes its replies and reactions according to the API contract.

---

## 10) Accessibility

- Radix headless primitives ship with correct ARIA and keyboard behavior.
- All interactive elements reachable by keyboard; focus rings visible.
- Colour contrast ≥ WCAG AA in every theme (see `Profiles.theme_name`).
- Media (photos, videos) uses provided `caption` for `alt` where present; falls back to a sensible default.
- SSE-driven live regions announce new notifications politely (`aria-live="polite"`).

---

## 11) Internationalization (i18n)

Every string in the UI is translatable; **user-generated content is not** — open mic descriptions, schedule text, reviews, and media captions stay in whatever language the author typed them, per the technical architecture's deferral of server-side content localization.

**Library.** `react-i18next` runtime (< 10 KB gzip) with JSON resource files. Plurals via i18next's built-in rules keyed off the resolved locale; no ICU MessageFormat runtime.

**Locale resolution order.** On session start the client resolves an active locale using the first rule that matches:

1. **Signed-in account preference** — `Accounts.preferred_language` from `GET /auth/profile` (BCP 47 tag; nullable).
2. **Explicit UI choice** — `localStorage['openmic:lang']`, set by the language switcher.
3. **Browser** — best-match between `navigator.languages` and the manifest in `src/i18n/supported.ts`.
4. **Fallback** — `en`.

**Changing language.** The switcher (a) writes to localStorage optimistically, (b) reloads active i18next namespaces, (c) updates the `<html lang>` attribute, and (d) if signed in, fires `PUT /accounts/:id` with the new `preferred_language`. If (d) fails, the local choice still stands; a retry piggybacks on the next mutation.

**Cross-device consistency.** On subsequent session start for a signed-in user, the server's `preferred_language` wins over localStorage (durable choice, possibly set from another device); the client updates localStorage to match, so a later signed-out visit on the same browser is consistent.

**Sign-out** leaves the localStorage preference in place — it's a UI choice, not sensitive.

**Resource layout.** `src/locales/<lang>/<namespace>.json`. Namespaces map to functional areas (`common`, `directory`, `dashboard`, `openMic`, `event`, `errors`) so each route loads only what it needs. Missing keys fall back to English; a dev-mode `console.warn` fires on every miss so translation gaps surface early.

**Bundling.** Only the `en` bundle ships with the shell. Other languages are dynamically imported per-namespace on first use (`await import(\`../locales/${lng}/${ns}.json\`)`); Vite emits each JSON as a hashed chunk. Each language pack targets **≤ 20 KB gzip across all namespaces**; the existing `size-limit` CI check enforces the budget so a new locale can't quietly balloon the initial load.

**Formatting.** `Intl.DateTimeFormat`, `Intl.NumberFormat`, and `Intl.RelativeTimeFormat` are keyed off the resolved locale via a small `useFormatters()` hook. `date-fns` calls pass `{ locale: dateFnsLocaleFor(current) }`. Money is formatted via `Intl.NumberFormat(locale, { style: 'currency', currency })` using the ISO 4217 code from `entry_fee_currency` on the source row; a shared `formatEntryFee({ amount, currency, note })` helper implements the display rule (note verbatim → else "Free" when amount is 0 → else formatted currency).

**`<html lang>`.** Set on bootstrap and updated in place on switch; screen readers and search engines see the right value on every request.

**Language switcher.** Lives in the app-shell footer and in `/settings`. Each supported language is displayed in its own native name (`English`, `Gaeilge`, `Français`) so a user who can't read the current locale can still find their own.

**API integration.** `api/client.ts` sets `Accept-Language: <current>` on every request. The API error envelope is English-only for now; the header is in place so backend-generated messages can localize later without a client change.

**Backend touch.** The `Accounts` schema now carries `preferred_language` (`text`, BCP 47, nullable); `GET /auth/profile` returns it and `PUT /accounts/:id` accepts it in the body.

**Supported set at launch.** English only. Adding a new locale is a manifest entry in `src/i18n/supported.ts` plus a matching folder under `src/locales/` — no app code changes.

**Deferred.** Right-to-left languages (Arabic, Hebrew, Farsi) — Tailwind's RTL variants and Radix's `dir` prop will handle them when we get there, but layout audits and mirrored icons aren't in scope. A pseudolocale mode (`en-XA` — wraps every string in `Ëñglïsh` markers) is available in dev to spot untranslated chrome without shipping any translations.

---

## 12) Performance Targets

Measured on emerging-market 4G (3 Mbps, 100 ms RTT), median device:

| Metric | Target |
|---|---|
| First Contentful Paint | < 1.5 s |
| Largest Contentful Paint | < 2.5 s |
| Time to Interactive | < 3.0 s |
| Cumulative Layout Shift | < 0.05 |
| Route-transition perceived latency | < 100 ms warm, < 400 ms cold |
| Initial JS bundle (gzip) | ≤ 100 KB |

Perf hygiene we always keep on:
- Route-level and role-level `React.lazy` splits.
- Prefetch on hover for every `<Link>`.
- HTTP/2 or /3 + Brotli via the required CloudFront distribution.
- `<link rel="preconnect">` to `api.openmics.org`, `media.openmics.org`, Cognito, and the font CDN (`fonts.googleapis.com` + `fonts.gstatic.com`).
- **Inter** served from Google Fonts (variable weight subset); preload the primary weight and set `font-display: swap` so text renders in the system fallback while the webfont downloads.
- Images: `loading="lazy"`, `decoding="async"`, `srcset` where the server provides sizes; use `Media.thumbnail_url` for video posters.
- Zero blocking third-party scripts.

Perf budgets are enforced in CI with `size-limit` (fail the build if any route chunk grows past its cap).

---

## 13) Deployment

- Vite build → `dist/`.
- Immutable, hashed assets are uploaded to the private frontend S3 origin and served through the required CloudFront distribution with Brotli and HTTP/3.
- CloudFront sends ordinary SPA routes to the S3 app shell. It sends canonical public handle routes (`/@:handle` and `/@:handle/events/:eventId`) to Fastify, which returns a minimal HTML document containing escaped page metadata, canonical tags, and the same Vite SPA entry script. Crawlers consume the metadata; browsers load the SPA normally. No crawler detection or separate OG endpoint is used.
- **Shared app shell:** `index.html` is the canonical Vite document template. The build copies a version with explicit metadata placeholders into the Fastify deployment artifact. Fastify replaces only those placeholders (`title`, description, canonical URL, and OpenGraph/Twitter tags) with escaped public values; it does not independently construct the document shell. Consequently, the Fastify response and S3 SPA response have the same root element, asset references, styles, scripts, and structure.
- **Preview environments**: one static bucket per PR (or a single bucket with per-PR prefixes), backed by the staging API.

---

## 14) Testing

- **Unit** (Vitest): pure logic, hooks with `@testing-library/react-hooks` semantics.
- **Component** (Vitest + React Testing Library): render + interaction with a mocked API layer (MSW).
- **Integration**: MSW mocks + real router + real query client to exercise route → data → mutation flows.
- **E2E** (Playwright): happy paths only — sign in, register for an event, upload media, post a comment, follow a profile, receive an SSE update. Runs against a staging stack in CI.
- **Contract**: a lightweight script consumes the API's OpenAPI and checks that the client's typed hooks reference existing operations.
- **Public-document parity:** CI compares the Fastify-rendered handle document with the built SPA shell after removing the permitted metadata elements; a mismatch in root markup, asset URLs, styles, or scripts fails the build.

---

## 15) What we're not building yet

- **PWA / offline** — not until we hear demand; Cognito auth complicates it.
- **Push notifications** — SSE is enough for MVP; revisit alongside the mobile app.
- **General server-side rendering** — excluded. Fastify renders only the minimal public handle document needed for metadata and SPA bootstrap; React page rendering remains client-side.
- **A marketing subsite in Astro** — good idea for `/about`, `/help`, `/terms`, `/privacy` when we care enough about their Lighthouse scores. Not on the MVP path.

---

## 16) Open questions

*None outstanding.*