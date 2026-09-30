# Web Guidance

## Application Structure

- This is a React 19 + TypeScript + Vite SPA. Routes are defined in `src/App.tsx` with TanStack Router; preserve the canonical route map in `docs/5-open-mic-frontend-architecture.md`.
- Use TanStack Query for server state and the shared API client in `src/api/`. Do not duplicate fetch/error/authorization behavior in individual views.
- Keep domain hooks and mutations in `src/features/`; keep reusable visual and interaction pieces in `src/components/`; keep page composition in `src/views/`.
- Use React Hook Form and Zod for every form. Reuse the shared location picker and location schemas rather than creating parallel map/geocoding flows.
- Use `i18next`/`react-i18next` for visible UI text. Add keys to the locale resources and run the untranslated-UI check; do not hard-code new user-facing strings.

## Product and UX Contracts

- Treat API responses and server authorization as authoritative. Hidden buttons are not permission enforcement, and client-side availability checks are only hints.
- Preserve guest registration provenance, explicit claim/adoption behavior, handle casing rules, and public/private visibility rules from the root documents.
- Keep Cognito behind the existing auth adapter and use Amplify only as the browser client. Never expose backend secrets or LocationIQ credentials in the bundle.
- Use the existing theme/color-mode system, responsive layout, visible focus states, reduced-motion behavior, and shared icon conventions. Keep organizer lifecycle actions and confirmations consistent across management surfaces.
- For roster live updates, use the established stream-token/SSE flow and invalidate or resync through the existing query keys; do not create a second realtime protocol.

## Tests and Commands

- From `apps/web`, `npm run build` runs TypeScript/Vite production validation, `npm run lint` runs Oxlint, and `npm test` runs Vitest plus the untranslated-UI check.
- Use `npm run test -- --run src/test/<focused-test>.test.tsx` for a focused Vitest check when appropriate.
- `npm run test:e2e` runs Playwright and may require the API, database, and configured environment from the repository's E2E setup.
- Prefer MSW only for isolated frontend tests. A mock must not conceal a missing production API operation; add or update API tests when the contract changes.
- Avoid syncing derived values into state with effects. Follow the repository's React hooks lint rules: do not set state directly in effects or mutate refs during render.