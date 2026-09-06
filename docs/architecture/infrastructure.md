# Infrastructure, Scalability, Security, and Deployment

**Related:** [../4-open-mic-technical-architecture.md](../4-open-mic-technical-architecture.md)

---

## 3) Infrastructure Components

### 3.1 Compute Layer — EC2

**Instance Type:** `t3.small` or `t3.medium`
- Burstable performance, cost-effective for MVP
- 2 vCPU, 2-4 GB RAM
- Can be upgraded without rearchitecture

**Configuration:**
- Single instance in a public subnet for MVP
- Elastic IP for consistent addressing
- Security groups restrict inbound to HTTPS/SSH only
- Auto-recovery enabled

**Node.js Application:**
- Fastify for REST API (JSON Schema validation + automatic OpenAPI via `@fastify/swagger`)
- PM2 or systemd for process management
- Environment-based configuration (dev/staging/prod)

**Scaling Path:** When traffic increases, migrate to:
- Auto-scaling group with multiple t3 instances behind a load balancer later
- Or container-based approach (ECS Fargate) if operational complexity becomes a burden

---

### 3.2 Database Layer — RDS PostgreSQL

**Instance Type:** `db.t3.small` with `gp3` storage
- Single AZ initially (can add Multi-AZ for HA later)
- 20 GB storage (sufficient for MVP)
- Automated daily backups (7-day retention)
- Enhanced monitoring disabled initially (reduce cost)

**Configuration:**
- VPC private subnet (no direct internet access)
- Security group allows inbound only from EC2
- Parameter group customized for small workloads
- Read replicas: none initially (can add for scale-out reads)

**Database Schema:**
- Tables: accounts, profiles, profile_links, profile_follows, events, registrations, performances, media, comments, private_messages, reactions, suggestions, deletions, pending_s3_deletions
- Reviews (event and open-mic) and review responses are stored in `comments` (see Data Model)
- **PostGIS enabled** (`CREATE EXTENSION IF NOT EXISTS postgis;`). `OpenMics.location` and `Events.location` are generated `geography(Point, 4326)` columns with GIST indexes, powering the directory's near-me search and map endpoints. Each event snapshots its location when it is created, defaulting to its parent open mic's address and coordinates so future edits to the series location never rewrite a historical event.
- Soft-deletable tables carry `deleted_at`, `deleted_by_profile_id`, `recovery_deadline`; the `deletions` journal backs the unified recycle bin
- S3 objects are never deleted inline; rows are appended to `pending_s3_deletions` and processed by a worker
- Proper indexing on foreign keys, event IDs, timestamps
- Soft deletes using `deleted_at` columns where applicable

**Backup Strategy:**
- Automated backups to S3 (cross-region for DR)
- Manual snapshots before major deployments
- Retention policy: 7 days automated, 30 days manual

---

### 3.3 Storage Layer — S3

**Buckets:**

1. **Photos Bucket** (`open-mic-photos-prod`)
   - Storage class: `INTELLIGENT_TIERING` (auto-transitions to cheaper tiers)
   - Versioning: disabled
   - Lifecycle policy: delete objects after 1 year (configurable)
   - S3 static website hosting enabled for public read access
   - Uploads require presigned URLs (PUT) issued by the API
   - Encryption: AWS managed (default)

2. **Frontend Build Bucket** (`open-mic-frontend-prod`)
   - Hosts static React build (HTML, CSS, JS)
  - Private S3 origin behind CloudFront; not served directly from S3 static website hosting
   - Versioning: disabled (rollback handled by re-deploying a previous build)
  - CloudFront is mandatory for HTTPS, SPA asset delivery, caching, and public handle routing

**Recycle Bin Implementation:**
- Logical soft delete in database (`deleted_at`, `deleted_by_profile_id`, `recovery_deadline` on each soft-deletable table)
- Every soft-delete appends a row to the `deletions` journal, which drives the unified recycle bin UI and the purge scheduler
- S3 objects are never deleted inline; a `pending_s3_deletions` queue is drained by an EventBridge-triggered worker after the retention period

---

### 3.4 Authentication — AWS Cognito

**User Pool Configuration:**
- Custom domain for hosted UI
- Email-based sign-up/sign-in
- MFA optional (can enforce for organizers later)
- Password policy: AWS defaults (adequate for MVP)

**Integration:**
- Frontend uses Amplify SDK (React wrapper)
- Backend validates JWTs via Cognito key validation
- User pool stores only identity claims; app-specific performer and organizer data stays in PostgreSQL

**Scalability:** Cognito is fully managed and scales automatically

---

### 3.5 Email Notifications — AWS SES

**Configuration:**
- Sandbox mode initially (send only to verified emails for testing)
- Move to production access on demand (simple request process)
- Send rate limit: start at 1 email/sec (sufficient for MVP)

**Integration:**
- Node.js backend uses AWS SDK (ses client)
- Email templates stored in code (or SES templating)
- Transactional emails for: reviews, comments, reactions, private messages, password resets

**Email Queue:**
- Node.js API enqueues every outbound email to an SQS queue (never calls SES inline).
- An AWS Lambda function is wired to the queue as an SQS event source; it consumes messages and calls SES.
- Delivery is effectively real-time; no batching or digests for MVP.
- Retries, backoff, and a dead-letter queue are handled by SQS + Lambda automatically.
- No idle worker to run: Lambda scales to zero when the queue is empty.

**Cost:** ~$0.10 per 1,000 emails (very cheap for MVP volume)

---

### 3.6 Networking & Load Balancing

**VPC:**
- Single VPC with public and private subnets
- Public subnet: EC2, routed directly to the Internet Gateway; no NAT Gateway is needed because the MVP API instance is public
- Private subnet: RDS

**DNS:**
- Route 53 for domain management (root domain: `openmics.org`)
- `www`/root domain (`openmics.org`, `www.openmics.org`) points to a CloudFront distribution with an ACM certificate
- CloudFront serves `/assets/*` and ordinary SPA requests from the frontend S3 origin. Browser-facing paths may be routed to the Fastify origin, which returns the shared SPA entry point without resolving or rendering entity-specific HTML.
- The Vite build will define the canonical HTML app-shell template. Its final packaging and metadata strategy remain pending frontend implementation.
- `api.openmics.org` points to the API CloudFront distribution, which routes `/api/*` to the Fastify origin; TLS terminates at CloudFront and the origin is health-checked
- `media.openmics.org` fronts the S3 media bucket (public reads served under our domain)

**Security:**
- Security groups restrict traffic (EC2 allows 80/443, optional 22 from admin IPs only)
- Network ACLs: default allow (can restrict later)
- No direct internet access to RDS from outside VPC

---

### 3.7 Monitoring & Logging

**CloudWatch:**
- EC2 CPU, Memory, Disk metrics
- RDS CPU, Memory, connections, query performance
- Custom metrics via SDK (e.g., user signups, event registrations)

**Log Groups:**
- `/aws/ec2/open-mic-api` — Node.js application logs
- `/aws/rds/open-mic-db` — Database slow queries (if enabled)

**Dashboards:**
- Single CloudWatch dashboard for key metrics
- Alarms for: high error rate (>5%), high latency (>1s), DB connection exhaustion

**Cost Logging:** Enable AWS Cost Anomaly Detection

---

### 3.8 CI/CD Pipeline

**GitHub Actions (simple, no cost):**
```yaml
Workflow: On push to main
1. Lint & Test (Node.js + React)
2. Run integration tests against staging DB
3. Deploy to staging (manual approval)
4. Deploy to production (manual approval)
```

**Deployment Strategy (Direct to EC2):**
- SSH into EC2, git pull latest code
- Install/update npm dependencies: `npm ci`
- Run database migrations: `npm run migrate`
- Restart Node.js app via PM2 or systemd: `pm2 restart all` or `systemctl restart open-mic-api`
- Build React frontend and push to S3
- Invalidate or revalidate the affected CloudFront cache paths after public asset or metadata changes
- Database migrations run before app restart
- Rollback via git reset to previous commit + restart

**Secrets Management:**
- GitHub Actions secrets for AWS credentials (used to deploy)
- AWS Secrets Manager or environment variables on EC2 for runtime secrets (DB credentials, API keys)

---

### 3.9 Real-Time Notifications — SSE

**Implementation:**
- Node.js Fastify endpoint: `GET /api/notifications/stream`
- Maintains long-lived HTTP connection (SSE)
- Emits events when notifications occur (comments, reviews, messages, reactions)
- Automatic reconnect with exponential backoff on client

**Architecture:**
- EventEmitter in Node.js tracks connected clients per user
- When notification created in DB, emit to connected clients
- Also store in DB for offline users (show on next login) — see `Notifications` in the Data Model, including the read-state and email-debounce rules
- Timeout & cleanup: disconnect idle connections after 30 mins

**Limitations:**
- Single EC2 instance: all clients must connect to same server
- Scaling: multi-instance setup requires Redis pub/sub or similar

**Cost:** No additional cost (uses existing EC2 capacity)

---


## 7) Scalability Path

**Phase 1 (Current):** Single t3.small EC2 + RDS (current state)
- Supports ~1,000 concurrent users with burst capacity

**Phase 2 (5,000+ users):**
- RDS: Add read replica in same AZ for read scaling
- EC2: Migrate to 2-3 instances behind a load balancer if needed
- Add ElastiCache (Redis) for session caching if needed
- Enable RDS Multi-AZ for high availability
- Migrate quotas from `Accounts.plan` + constants map to `Plans` / `Subscriptions` tables and integrate Stripe (see Plans & quotas migration path in Data Model)

**Phase 3 (10,000+ users):**
- Consider containerizing Node.js (Docker) and deploying on ECS/Fargate for better operational management
- RDS: Multi-AZ with read replicas in multiple regions
- S3: Add CloudFront for media CDN
- Consider SQS for email queue if volume spikes
- Separate read/write databases if needed

**Phase 4 (Massive scale):**
- Event sourcing for audit trail
- DynamoDB for real-time notifications (fan-out pattern)
- API Gateway for rate limiting + WAF
- Lambda for background jobs (instead of cron)
- Consider separate services for analytics, notifications

---

## 8) Cost Estimation (Year 1, MVP)

**Monthly Costs (Approximate):**

| Component | Cost | Notes |
|-----------|------|-------|
| **EC2** | $20–30 | t3.small reserved instance ~$0.023/hr |
| **RDS** | $30–50 | db.t3.small multi-AZ not needed yet |
| **S3** (Media) | $5–10 | Assuming 100 GB storage, ~few TB/month transfer |
| **Data Transfer** | $5–10 | Outbound data to internet (~2 TB/month @ $0.09/GB) |
| **Cognito** | $0–10 | First 50K monthly active users free, then $0.015/MAU |
| **SES** | <$1 | Bulk email rate $0.10 per 1,000 emails |
| **CloudWatch** | $5–10 | Logs + dashboards |
| **Route 53** | $1 | DNS |
| **ACM** | $0 | Free SSL certificates |
| **Total/Month** | **~$80–150** | Can be optimized further |

**Year 1 Estimate:** ~$960–1,800

**Cost Optimization Tips:**
- Use Reserved Instances for EC2/RDS (30% discount)
- Enable S3 Intelligent-Tiering for older media
- Compress logs and delete old CloudWatch logs
- Use free tier services where applicable (CloudFront has generous limits)

---

## 9) Security Considerations

**Authentication & Authorization:**
- Cognito handles user auth; validate JWTs on every API request
- Role-based access control: user, performer, organizer
- Organizers can only modify their own open-mics and events

**Data Protection:**
- All data encrypted in transit (TLS 1.2+)
- RDS encryption at rest enabled
- S3 encryption enabled (default)
- No sensitive data in logs (passwords, tokens)

**API Security:**
- HTTPS only (no HTTP)
- CORS configured for frontend domain only
- Input validation on all endpoints
- Rate limiting per user (100 req/min)
- CSRF protection for state-changing operations

**Infrastructure Security:**
- EC2 security group: inbound only from trusted public ports/IPs
- RDS security group: inbound only from EC2
- S3 bucket policies: public read for website-hosted photos; uploads allowed only via presigned URLs
- Secrets stored in GitHub Actions + AWS Secrets Manager
- IAM roles with least privilege

**Monitoring:**
- CloudTrail logs all AWS API calls
- VPC Flow Logs for network analysis (enable if issues arise)
- CloudWatch alarms for suspicious activity

---

## 10) Deployment Strategy

**Environments:**
- **Local:** Developer machine (direct Node.js + PostgreSQL, see Development Workflow section)
- **Staging:** Mirror of production, AWS resources
- **Production:** Live application

**GitHub Actions Workflow:**
```yaml
name: Deploy

on:
  push:
    branches: [main]

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v3
      - name: Run tests & lint
        run: npm run test && npm run lint

  deploy-staging:
    needs: test
    runs-on: ubuntu-latest
    environment: staging
    steps:
      - uses: actions/checkout@v3
      - name: Deploy to staging EC2
        run: |
          ssh -i ${{ secrets.SSH_KEY }} ec2-user@staging.openmics.org
          cd /home/ec2-user/open-mic && git pull && npm run migrate && npm restart

  deploy-production:
    needs: deploy-staging
    runs-on: ubuntu-latest
    environment: production
    steps:
      - uses: actions/checkout@v3
      - name: Deploy to production EC2
        run: |
          ssh -i ${{ secrets.SSH_KEY }} ec2-user@prod.openmics.org
          cd /home/ec2-user/open-mic && git pull && npm run migrate && npm restart
```

**Rollback Strategy:**
- Keep last 3 deployments
- On failure: `git reset --hard HEAD~1 && npm restart`
- Database: transactions rollback on migration failure

---
