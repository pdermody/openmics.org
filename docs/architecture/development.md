# Development Workflow, Limitations, and Roadmap

> **Superseded historical document.** Current workflow and sequencing are maintained in [IMPLEMENTATION-PLAN.md](../../IMPLEMENTATION-PLAN.md) and the repository guidance in [AGENTS.md](../../AGENTS.md). This page is retained for history and should not be used as current planning guidance.

**Related:** [../4-open-mic-technical-architecture.md](../4-open-mic-technical-architecture.md)

---

## 11) Development Workflow

**Local Setup (Node.js + PostgreSQL):**
```bash
npm ci

# Start the local services described by docker-compose.yml, or provide PostgreSQL/PostGIS separately.
docker compose up -d

# Apply ordered node-pg-migrate migrations
npm run db:migrate

# Start the API and frontend in separate terminals
npm run dev:api
npm run dev:web
```

**Database Migrations:**
- Tool: `node-pg-migrate`
- Stored in `apps/api/migrations/`
- Run explicitly with `npm run db:migrate`; deployment automation must run migrations as a controlled release step.

**Testing:**
- API unit and injection tests: Vitest (`npm run test:unit`, `npm run test:api`)
- PostgreSQL integration tests: Vitest + Testcontainers (`npm run test:integration`)
- Frontend checks: `npm run test:web` and the frontend package's build/lint commands
- OpenAPI checks: `npm run validate:openapi`, `npm run lint:openapi`, `npm run coverage:openapi`

**Monitoring in Dev:**
- The API uses structured Fastify logging. Email, geocoding, and authentication boundaries have deterministic local adapters for development and tests.

---

## 12) Known Limitations & Future Improvements

| Limitation | Impact | Future Solution |
|-----------|--------|-----------------|
| Local single-process development | Not representative of production failure modes | ECS Fargate, RDS, and CDK-managed environments |
| No database read replicas | Read scalability limited | Add read replicas for analytics |
| PostgreSQL-backed SSE fan-out | Adds database notifications to roster writes | Revisit a broker only if Phase 1 load requires it |
| Staging platform not deployed | Production behavior is not yet proven | Complete the CDK application stacks and staging smoke tests |
| No API Gateway | No rate limiting at edge | AWS API Gateway + WAF |
| No caching layer | Repeated DB queries | Redis ElastiCache |

---

## 13) Next Steps (Implementation)

1. Reconcile the executable API contract and operation coverage.
2. Implement production Cognito ID-token verification and account provisioning.
3. Complete account/profile preferences and mandatory onboarding.
4. Add frontend automated coverage for registration, roster, kiosk, and auth workflows.
5. Implement canonical vanity resolution and route migration.
6. Define and implement the media storage/API contract before building upload UI.
7. Complete CDK application infrastructure, CI, staging deployment, and operational runbooks.
8. Later phase: performer-authored content, comments, reviews, reactions, notifications, and private messaging.

---

## 14) Team & Operational Responsibilities

| Role | Responsibilities |
|------|------------------|
| **Backend Lead** | API design, database, deployment automation |
| **Frontend Lead** | React components, UI/UX, real-time integration |
| **DevOps/Infrastructure** | AWS setup, monitoring, scaling decisions |
| **QA** | Testing, performance validation, edge cases |

**On-Call Rotation:** Start with 1-2 engineers covering alerts

---

## Questions & Decisions Ahead

- [x] Use AWS CDK with ECS Fargate for the API and S3/CloudFront for the SPA
- [x] SQS queue for emails (real-time worker; no direct SES calls, no batching)
- [x] Redis caching: **not** in MVP; revisit in Phase 2
- [x] Custom domain `openmics.org` for the website with a `media.openmics.org` subdomain fronting S3
- [x] Email notifications sent in real time (no daily digest for MVP)
