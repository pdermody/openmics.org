# Development Workflow, Limitations, and Roadmap

**Related:** [../4-open-mic-technical-architecture.md](../4-open-mic-technical-architecture.md)

---

## 11) Development Workflow

**Local Setup (Direct Node.js + PostgreSQL):**
```bash
# Install dependencies
npm ci
npm install -g db-migrate

# Start PostgreSQL locally (or use Docker for DB only)
# Option 1: Local PostgreSQL
psql -U postgres -c "CREATE DATABASE open_mic_dev;"

# Option 2: Docker for DB only (optional)
docker run -d --name postgres -e POSTGRES_PASSWORD=dev -p 5432:5432 postgres:15

# Run migrations
npm run migrate

# Start Node.js API server
npm start

# In another terminal, start React frontend
cd frontend && npm start
```

**Database Migrations:**
- Tool: db-migrate or Knex.js
- Stored in `/migrations` folder
- Run automatically on deployment (`npm run migrate`)

**Testing:**
- Unit tests: Jest for API logic
- Integration tests: Supertest for API endpoints
- E2E tests: Cypress/Playwright for critical flows

**Monitoring in Dev:**
- Morgan middleware logs HTTP requests
- Debug package for detailed logging

---

## 12) Known Limitations & Future Improvements

| Limitation | Impact | Future Solution |
|-----------|--------|-----------------|
| Single EC2 instance | Single point of failure | Auto-scaling group + RDS Multi-AZ |
| No database read replicas | Read scalability limited | Add read replicas for analytics |
| SSE on single server | Doesn't scale across instances | Redis pub/sub or SQS |
| No CDN | Media served directly from app/S3 | CloudFront distribution |
| No API Gateway | No rate limiting at edge | AWS API Gateway + WAF |
| No caching layer | Repeated DB queries | Redis ElastiCache |
| Direct EC2 deployment | Manual deployments, no containerization | Docker + ECS/Fargate for later scaling |

---

## 13) Next Steps (Implementation)

1. **Week 1:** Set up AWS account, VPC, EC2, RDS, S3
2. **Week 2:** Deploy Node.js skeleton, Cognito integration
3. **Week 3:** Database schema, core API endpoints
4. **Week 4:** Frontend scaffolding, authentication flow
5. **Week 5:** Organizer series, event, roster, and registration workflows
6. **Week 6:** Guest and authenticated registration, email verification, kiosk flow, and magic-link editing
7. **Week 7:** Public home, profile, open-mic, event, and registration pages plus organizer-owned media
8. **Week 8:** End-to-end testing, capacity/concurrency checks, accessibility, and staging validation
9. **Week 9:** Security audit, analytics, documentation, and operational runbooks
10. **Week 10:** Production launch preparation and monitoring setup
11. **Later phase:** Performer-authored content, comments, reviews, reactions, notifications, and private messaging

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

- [x] Use direct Node.js on EC2 for MVP (no Docker containerization)
- [x] SQS queue for emails (real-time worker; no direct SES calls, no batching)
- [x] Redis caching: **not** in MVP; revisit in Phase 2
- [x] Custom domain `openmics.org` for the website with a `media.openmics.org` subdomain fronting S3
- [x] Email notifications sent in real time (no daily digest for MVP)
