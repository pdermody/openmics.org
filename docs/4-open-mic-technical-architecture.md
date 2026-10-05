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
| Data model | [architecture/data-model.md](architecture/data-model.md) | Phase 1 PostgreSQL schema (Accounts, Profiles, Handles, OpenMics, Events, Registrations, Performances, Media) plus the post-MVP appendix for follows, comments, reactions, messaging, notifications, roles, and quotas |
| API design | [architecture/api-design.md](architecture/api-design.md) | Deferred (post-MVP) surface, directory/map behavior, home-page feed rules, personalization, geocoding proxy, and error envelope. The executable operation list lives in [`openapi.yaml`](../openapi.yaml) |
| Frontend architecture | [5-open-mic-frontend-architecture.md](5-open-mic-frontend-architecture.md) | Stack, routing, the canonical [Key Pages (Route Map)](5-open-mic-frontend-architecture.md#key-pages-route-map), data fetching, auth, accessibility, i18n |
| Handle lifecycle | [6-open-mic-vanity-urls.md](6-open-mic-vanity-urls.md) | Vanity URL and handle policy |
| Map/location-picker research | [research/open-mic-map-location-picker.md](research/open-mic-map-location-picker.md) | Options considered for the venue map/geocoding picker; background for the decisions recorded in [decisions.md](decisions.md#forms-and-location-picker) |

Current infrastructure, deployment, and workflow guidance lives in [FEATURE-PLAN.md](FEATURE-PLAN.md), [decisions.md](decisions.md), [AGENTS.md](../AGENTS.md), and the [infra/](../infra/) CDK sources. The prior EC2-oriented overview/infrastructure/development pages have been removed.

Use [decisions.md](decisions.md) first for any settled cross-document policy; only open the detailed files above when the specific implementation detail is needed.
