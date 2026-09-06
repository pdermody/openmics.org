# Open Mic Technical Architecture Document

**Status:** Draft  
**Date:** 2026-08-16  
**Technology Stack:** Node.js, React, PostgreSQL, AWS  

---

## Phase 1 implementation boundary

Phase 1 implements organizer operations, event creation and management, low-friction guest and authenticated registration, public read-only pages, and organizer-owned photos and video links. Performers may browse and register but cannot publish content or use comments, reviews, reactions, or messaging. Those capabilities remain represented in the broader architecture as later-phase extension points.

## Index

This document is an index. Detailed content lives in the linked files so each concern can be read on its own, without pulling in unrelated sections.

| Topic | File | Covers |
|---|---|---|
| Architecture overview | [architecture/overview.md](architecture/overview.md) | Goals, constraints, high-level system diagram |
| Infrastructure, scaling, security, deployment | [architecture/infrastructure.md](architecture/infrastructure.md) | AWS components (EC2, RDS, S3, Cognito, SES, networking, monitoring, CI/CD, SSE), scalability path, cost estimation, security considerations, deployment strategy |
| Data model | [architecture/data-model.md](architecture/data-model.md) | Full PostgreSQL schema for all entities, constraints, indexes, triggers, and permission/notification/deletion mechanics |
| API design | [architecture/api-design.md](architecture/api-design.md) | REST conventions, error envelope, endpoint list, quotas, home page feed rules |
| Frontend architecture | [5-open-mic-frontend-architecture.md](5-open-mic-frontend-architecture.md) | Stack, routing, the canonical [Key Pages (Route Map)](5-open-mic-frontend-architecture.md#key-pages-route-map), data fetching, auth, accessibility, i18n |
| Handle lifecycle | [6-open-mic-vanity-urls.md](6-open-mic-vanity-urls.md) | Vanity URL and handle policy |
| Development workflow, limitations, roadmap | [architecture/development.md](architecture/development.md) | Local setup, known limitations, implementation next steps, team responsibilities, open questions |

Use [decisions.md](decisions.md) first for any settled cross-document policy; only open the detailed files above when the specific implementation detail is needed.
