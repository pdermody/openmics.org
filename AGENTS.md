# Repository Guidance

## Document Authority

- `docs/3-open-mic-requirements.md` is authoritative for product behavior and permissions.
- `docs/6-open-mic-vanity-urls.md` is authoritative for handle lifecycle, casing, routing, and visibility policy.
- `docs/4-open-mic-technical-architecture.md` is authoritative for persistence, infrastructure, and implementation boundaries.
- `openapi.yaml` is the API contract and must be aligned with the authoritative product and architecture documents.
- `docs/decisions.md` records settled cross-document decisions. If a document conflicts with it, flag the conflict before changing behavior.

## Working Rules

- Treat documentation changes as specification changes: identify contradictions before editing.
- Preserve existing decisions unless the user explicitly changes them.
- Keep guest registration provenance separate from later profile adoption.
- Handles preserve canonical casing, compare case-insensitively, and distinguish case-only changes from semantic renames.
- Run `npm run validate:openapi` after OpenAPI changes.
- Run `npm run lint:openapi` after API contract changes.
- Run `npm run check:links` after moving or renaming documents.
- Use `npm run lint:markdown` for Markdown quality checks; existing legacy formatting findings may remain until deliberately cleaned up.
