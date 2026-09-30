# API Guidance

## Runtime Boundary

- The API is a TypeScript Fastify application. `src/app.ts` builds the injectable app; `src/server.ts` is the process entrypoint.
- Keep the API JSON-only under `/api`. SPA/vanity routing belongs to the existing route boundary and must not turn entity APIs into server-rendered HTML.
- Keep domain code grouped by bounded area (`accounts`, `auth`, `events`, `handles`, `open-mics`, `performances`, `profiles`, `registrations`). Put validation beside the owning domain.
- Keep database access in repositories/services and use the shared pool/transaction helpers. Do not put SQL in route handlers unless the existing local pattern requires it.
- Validate external input with Zod and return the established structured error envelope and error codes.

## Data and Contract

- PostgreSQL/PostGIS is the persistence boundary. Schema changes require a new ordered migration under `migrations/`; never edit an applied migration to change production behavior.
- Preserve ownership checks, public serialization rules, soft-delete/recovery windows, and the distinction between guest provenance, account claims, and adopted profile attribution.
- Handles are case-insensitive for lookup/uniqueness but retain canonical casing. Only performer profiles have handles; organizer presence is represented by open-mic series handles.
- Keep `openapi.yaml` aligned with routes, schemas, status codes, and authorization behavior. Update API tests and contract coverage when operations change.
- Authenticated browser requests use Cognito ID tokens. Never trust admin or ownership claims from the token in place of database state.

## Tests and Commands

- Unit tests in `tests/unit` must remain database/AWS-free and use injected fakes.
- API tests in `tests/api` use Fastify injection and should cover authorization, serialization, validation, and OpenAPI operation coverage.
- Integration tests in `tests/integration` use real PostgreSQL/PostGIS through Testcontainers for migrations, constraints, transactions, and concurrency behavior.
- From the repository root, use `npm run typecheck:api`, `npm run test:unit`, `npm run test:api`, and `npm run test:integration` for focused checks. Run `npm run test` for the full suite.
- Run `npm run validate:openapi` and `npm run lint:openapi` after contract changes. Run `npm run db:migrate:e2e`/`npm run db:seed:e2e` only against the configured E2E database.
- Do not log bearer tokens, registration edit tokens, kiosk PINs, stream tokens, request secrets, or database credentials.