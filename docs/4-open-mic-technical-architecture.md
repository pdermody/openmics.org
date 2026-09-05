# Open Mic Technical Architecture Document

**Status:** Draft  
**Date:** 2026-08-16  
**Technology Stack:** Node.js, React, PostgreSQL, AWS  

---

## Phase 1 implementation boundary

Phase 1 implements organizer operations, event creation and management, low-friction guest and authenticated registration, public read-only pages, and organizer-owned photos and video links. Performers may browse and register but cannot publish content or use comments, reviews, reactions, or messaging. Those capabilities remain represented in the broader architecture as later-phase extension points.

## 1) Architecture Overview

### Goals
- **Reliability:** Highly available application with graceful degradation
- **Scalability:** Can grow from 1,000 to 10,000+ users without major rework
- **Cost Efficiency:** Minimize AWS spending while maintaining performance
- **Maintainability:** Simple deployment and operational procedures

### Initial Constraints
- 1,000 users in year 1
- ~10 open-mics, few dozen events per month
- Media stored (photos on S3, videos embedded from platforms)
- Single EC2 instance for MVP
- Server-Sent Events (SSE) for real-time notifications

---

## 2) High-Level System Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Internet / Users                         │
└──────────────────────────┬──────────────────────────────────────┘
                           │
                           ▼
                ┌──────────────────────┐
                │   Route 53 (DNS)     │
                └──────────┬───────────┘
                           │
          ┌────────────────┴────────────────┐
          ▼                                 ▼
┌──────────────────────┐          ┌──────────────────────┐
│ CloudFront + S3      │──API────►│   Node.js API on     │
│ static SPA assets    │  calls   │       EC2 + SSE      │
└──────┬───────────────┘          └──────────┬───────────┘
       │                                     │
       │ auth + media reads                  │ DB · media R/W · SQS enqueue
       │                                     │
       ├──────────────┐             ┌────────┼─────────────┐
       ▼              │             ▼        │             ▼
┌───────────────┐     │    ┌────────────────┐│    ┌────────────────┐
│  AWS Cognito  │     │    │ RDS PostgreSQL ││    │    AWS SQS     │
│    (Auth)     │     │    │   (Database)   ││    │  (Email queue) │
└───────────────┘     │    └────────────────┘│    └────────┬───────┘
                      │                      │             │ SQS event source
                      │                      │             ▼
                      │                      │    ┌────────────────┐
                      │                      │    │  Email Lambda  │
                      │                      │    │  (drains SQS)  │
                      │                      │    └────────┬───────┘
                      │                      │             │
                      │                      │             ▼
                      │                      │    ┌────────────────┐
                      │                      │    │    AWS SES     │
                      │                      │    │    (Email)     │
                      │                      │    └────────────────┘
                      ▼                      ▼
                   ┌────────────────────────────┐
                   │        AWS S3 (Media)      │
                   │  (frontend reads, API R/W) │
                   └────────────────────────────┘

  Supporting Services:
  - CloudWatch (Logs & Monitoring)
  - EventBridge (Scheduled Tasks)
  - SQS (Email queue)
  - Lambda (Email worker that drains SQS and calls SES)
```

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
- CloudFront serves `/assets/*` and ordinary SPA requests from the frontend S3 origin; it routes `/@*` and `/@*/events/*` to the Fastify origin, which returns a public HTML document with page metadata and the SPA entry script
- The Vite build produces the canonical HTML app-shell template. The deployment packages that template with Fastify, which replaces only explicit, escaped metadata placeholders for public handle requests; the root element, asset URLs, scripts, styles, and document structure remain identical to the S3-served SPA shell.
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

## 4) Data Model (Key Entities)

```sql
Accounts
├── id (UUID)
├── cognito_id
├── email
├── display_name
├── city (optional)
├── preferred_language (text, nullable — BCP 47 tag e.g. 'en', 'ga', 'fr'; drives the frontend's i18n locale resolution when set; NULL means "honour the browser")
├── current_profile_id (FK to Profiles, nullable — indicates which profile user is currently using)
├── is_platform_admin (boolean — platform super user, manages entire platform)
├── plan ("free" | "pro") — default "free"; drives quota limits (see Plans & quotas)
├── referred_by_profile_id (FK to Profiles, nullable — referral supplied in a validated Cognito OAuth state value and stored when the application account is first provisioned; never overwritten afterward)
├── referred_at (timestamptz, nullable — set together with referred_by_profile_id during account provisioning)
├── created_at, updated_at
# UNIQUE (email); UNIQUE (cognito_id); CHECK (plan IN ('free','pro'));
# CHECK ((referred_by_profile_id IS NULL) = (referred_at IS NULL));

Profiles (unified performer & organizer identities)
├── id (UUID)
├── created_by_account_id (FK — account that created this profile)
├── slug (text — UNIQUE; used for public URLs like `/profiles/alice-band`)
├── profile_name (e.g., "Solo", "Jazz Band", or open mic series name)
├── profile_kind ("organizer" | "performer" — organizer profiles own open-mic series; performer profiles are the identities selected on registrations)
├── bio
├── profile_image_url (S3 URL or NULL)
├── theme_name (named theme for UI customization; themes defined separately)
├── visibility ("public" | "unlisted" | "private") — default "public"
├── created_at, updated_at
├── deleted_at, deleted_by_profile_id (FK, nullable), recovery_deadline
# UNIQUE (slug); CHECK (visibility IN ('public','unlisted','private'))
# CHECK (profile_kind IN ('organizer','performer'));

ProfileLinks (contact and social links for a profile)
├── id (UUID)
├── profile_id (FK — Profiles entry)
├── type ("website" | "instagram" | "youtube" | "tiktok" | "twitter" | "facebook" | "spotify" | "bandcamp" | "email" | "phone" | "other")
├── url (or contact string for email/phone)
├── label (nullable — optional display label override)
├── sequence (integer — display order)
├── created_at, updated_at
# CHECK (type IN ('website','instagram','youtube','tiktok','twitter','facebook','spotify','bandcamp','email','phone','other'));
# INDEX (profile_id, sequence)

ProfileFollows (one profile "likes"/follows another)
├── id (UUID)
├── follower_profile_id (FK — Profiles entry doing the follow)
├── followee_profile_id (FK — Profiles entry being followed)
├── created_at
# UNIQUE (follower_profile_id, followee_profile_id);
# CHECK (follower_profile_id <> followee_profile_id);
# INDEX (follower_profile_id); INDEX (followee_profile_id)

Roles (permission groups)
├── id (UUID)
├── name (e.g., "Owner", "Admin", "Assistant", "Performer", "Organizer")
├── description
├── created_at, updated_at

Permissions (fine-grained capabilities)
├── id (UUID)
├── key (e.g., "profiles:view", "profiles:edit", "profiles:delete", "registrations:create", "registrations:collect", "events:manage")
├── description
├── created_at, updated_at

RolePermissions (maps roles to permissions)
├── id (UUID)
├── role_id (FK)
├── permission_id (FK)
├── created_at

AccountProfileRoles (links accounts to profiles with specific roles)
├── id (UUID)
├── account_id (FK)
├── profile_id (FK)
├── role_id (FK)
├── granted_at
├── created_at, updated_at

ProfileInvitations (pending invites for accounts to join profiles with specific roles)
├── id (UUID)
├── profile_id (FK)
├── invited_account_id (FK — account being invited)
├── invited_by_account_id (FK — account that sent the invite)
├── role_id (FK — role to be granted upon acceptance)
├── token (text — opaque URL token for the invite link)
├── status ("pending" | "accepted" | "rejected")
├── accepted_at (NULL until accepted)
├── rejected_at (NULL until rejected)
├── expires_at (timestamptz — default now() + interval '14 days')
├── created_at, updated_at
# UNIQUE (token)

Comments
├── id (UUID)
├── profile_id (FK — Profiles entry indicating which profile authored the comment)
├── text
├── rating (1-5, nullable — set only for reviews of an event or open_mic)
├── created_at, updated_at
# No soft-delete columns: a deleted comment is not recoverable.
# Exactly one typed target association below must exist for each comment; a transaction-level association trigger rejects zero or multiple target rows.
# Threaded replies use CommentComments; deleting a comment cascades to its replies.
# A review is a Comment linked through CommentEvents or CommentOpenMics with rating IS NOT NULL.
# The UI shows an "edited" indicator when updated_at > created_at (no separate edited_at column).

**Comment and review moderation.** Moderation is post-publication: comments and reviews are visible immediately after a successful write. There is no approval queue or pending moderation state. Authors may edit or permanently delete their own comments/reviews; media owners may permanently delete comments attached to their media; and the owning organizer may permanently delete comments/reviews attached to media, events, or open-mics in that organization, including content authored by performers. Because comments are not soft-deleted, a moderation removal is a hard delete and cascades to replies and reactions as defined above. Moderation actions are authorized server-side and recorded in the audit log where an organizer or platform-admin permission is used.

CommentMedia
├── comment_id (PK, FK → Comments.id ON DELETE CASCADE)
├── media_id (FK → Media.id ON DELETE CASCADE)
├── created_at
# UNIQUE (media_id, comment_id)

CommentComments
├── comment_id (PK, FK → Comments.id ON DELETE CASCADE)
├── parent_comment_id (FK → Comments.id ON DELETE CASCADE)
├── created_at
# UNIQUE (parent_comment_id, comment_id)

CommentEvents
├── comment_id (PK, FK → Comments.id ON DELETE CASCADE)
├── event_id (FK → Events.id ON DELETE CASCADE)
├── created_at
# UNIQUE (event_id, comment_id)

CommentOpenMics
├── comment_id (PK, FK → Comments.id ON DELETE CASCADE)
├── open_mic_id (FK → OpenMics.id ON DELETE CASCADE)
├── created_at
# UNIQUE (open_mic_id, comment_id)

CommentPrivateMessages
├── comment_id (PK, FK → Comments.id ON DELETE CASCADE)
├── private_message_id (FK → PrivateMessages.id ON DELETE CASCADE)
├── created_at
# UNIQUE (private_message_id, comment_id)

CommentSuggestions
├── comment_id (PK, FK → Comments.id ON DELETE CASCADE)
├── suggestion_id (FK → Suggestions.id ON DELETE CASCADE)
├── created_at
# UNIQUE (suggestion_id, comment_id)

Reactions
├── id (UUID)
├── type ("like" | "upvote")
├── created_at, updated_at
# No soft-delete columns: deleting a reaction removes it permanently.
# Exactly one typed target association below must exist for each reaction; a transaction-level association trigger rejects zero or multiple target rows.
# Reactions are editable by their author; updates change `type` and `updated_at`.

ReactionMedia
├── reaction_id (PK, FK → Reactions.id ON DELETE CASCADE)
├── media_id (FK → Media.id ON DELETE CASCADE)
├── profile_id (FK → Profiles.id)
# UNIQUE (media_id, profile_id, type)

ReactionComments
├── reaction_id (PK, FK → Reactions.id ON DELETE CASCADE)
├── comment_id (FK → Comments.id ON DELETE CASCADE)
├── profile_id (FK → Profiles.id)
# UNIQUE (comment_id, profile_id, type)

ReactionPrivateMessages
├── reaction_id (PK, FK → Reactions.id ON DELETE CASCADE)
├── private_message_id (FK → PrivateMessages.id ON DELETE CASCADE)
├── profile_id (FK → Profiles.id)
# UNIQUE (private_message_id, profile_id, type)

ReactionSuggestions
├── reaction_id (PK, FK → Reactions.id ON DELETE CASCADE)
├── suggestion_id (FK → Suggestions.id ON DELETE CASCADE)
├── profile_id (FK → Profiles.id)
# UNIQUE (suggestion_id, profile_id, type)

OpenMics
├── id (UUID)
├── owner_profile_id (FK → Profiles.id)
├── current_handle (FK → Handles.handle, unique)
├── slug (text — legacy/internal identifier, unique)
├── name
├── description (nullable)
├── activities text[]
├── venue_name (NOT NULL)
├── address_line1 (NOT NULL), address_line2 (nullable)
├── postcode (nullable), city (NOT NULL), country (NOT NULL)
├── lat numeric(9,6), lng numeric(9,6) (nullable)
├── time_zone (text — IANA time zone such as `Europe/Dublin`)
├── website (text, nullable)
├── contact_email (text, nullable)
├── schedule_summary (text, nullable — short public fallback such as "Every 2nd Tuesday, 8pm")
├── schedule_details (text, nullable — longer public schedule explanation)
├── originals_only (boolean, default false)
├── amplification_available (boolean, default false)
├── age_policy ("adults_only" | "children_only" | "both")
├── registration_mode ("pre_only" | "on_night_only" | "both" | "external")
├── external_registration_url (text, nullable — required when registration_mode='external'; where visitors go to register when there's no on-platform registration for this open mic)
├── entry_fee_amount (numeric(10,2), NOT NULL, default 0.00 — 0 means free entry, which is the common case for open mics)
├── entry_fee_currency (text, nullable — ISO 4217 3-letter code e.g. 'EUR', 'GBP', 'USD'; required when entry_fee_amount > 0, otherwise ignored)
├── entry_fee_note (text, nullable — free-text override; when set, the UI displays this verbatim instead of formatting the amount, covering cases like "Pay what you can", "€5–€10 sliding scale", or "Free but please buy a drink")
├── rating_avg (numeric(2,1), nullable — denormalized average of Comments linked through CommentOpenMics where rating IS NOT NULL and the open mic is visible)
├── rating_count (integer, default 0 — denormalized count of the same rows; kept in sync by a trigger on Comments)
├── location (geography(Point, 4326) GENERATED ALWAYS AS (
│              CASE WHEN lat IS NOT NULL AND lng IS NOT NULL
│                   THEN ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography
│              END) STORED — spatial column for map + near-me queries)
├── tags text[]
├── status ("active" | "paused" | "ended" | "draft") — default "draft"
├── created_at, updated_at
├── deleted_at, deleted_by_profile_id (FK, nullable), recovery_deadline
# CHECK (activities <@ ARRAY['singing','poetry','jam','trad','comedy','storytelling','other']);
# CHECK (array_length(activities, 1) >= 1); INDEX GIN (activities); INDEX GIN (tags)
# CHECK (age_policy IN ('adults_only','children_only','both'));
# CHECK (registration_mode IN ('pre_only','on_night_only','both','external'));
# CHECK (registration_mode <> 'external' OR external_registration_url IS NOT NULL);
# CHECK (entry_fee_amount = 0 OR entry_fee_currency IS NOT NULL);
# CHECK (entry_fee_amount >= 0);
# CHECK (status IN ('active','paused','ended','draft'));
# INDEX GIST (location);   -- fast bounding-box + ST_DWithin queries
# INDEX (rating_avg DESC NULLS LAST) WHERE deleted_at IS NULL;
# UNIQUE (slug)

Events
├── id (UUID)
├── open_mic_id (FK)
├── slug (text — URL slug scoped to the open mic, e.g. `july-2026`)
├── title
├── starts_at (timestamptz — date and local start time converted using `time_zone`)
├── ends_at (timestamptz, nullable — local end time converted using `time_zone`)
├── time_zone (text — IANA time zone such as `Europe/Dublin`, used for local editing/display and cutoff calculations)
├── running (boolean, nullable — set true when the organizer starts, false when they stop)
├── registrations_closed_at (timestamptz, nullable — no new registrations after this time)
├── venue_name (NOT NULL — defaults from OpenMics when the event is created)
├── address_line1 (NOT NULL), address_line2 (nullable)
├── postcode (nullable), city (NOT NULL), country (NOT NULL)
├── lat numeric(9,6), lng numeric(9,6) (nullable — defaults from OpenMics when the event is created)
├── location (geography(Point, 4326) GENERATED ALWAYS AS (
│              CASE WHEN lat IS NOT NULL AND lng IS NOT NULL
│                   THEN ST_SetSRID(ST_MakePoint(lng, lat), 4326)::geography
│              END) STORED — map location generated from the event's copied coordinates)
├── activities text[]  (nullable — NULL inherits from OpenMics.activities;
│                       when set, replaces the OpenMic's allowed set for this event)
├── tags text[]
├── capacity (integer, nullable)
├── entry_fee_amount (numeric(10,2), nullable — per-event override; NULL inherits from OpenMics.entry_fee_amount)
├── entry_fee_currency (text, nullable — per-event override; NULL inherits from OpenMics.entry_fee_currency)
├── entry_fee_note (text, nullable — per-event override; NULL inherits from OpenMics.entry_fee_note)
├── notes (text, nullable — organizer-only private notes)
├── rating_avg (numeric(2,1), nullable — denormalized average of Comments linked through CommentEvents where rating IS NOT NULL and the event is visible)
├── rating_count (integer, default 0 — denormalized count of the same rows; kept in sync by the review aggregation trigger)
├── created_at, updated_at
├── deleted_at, deleted_by_profile_id (FK, nullable), recovery_deadline
# CHECK (activities IS NULL OR activities <@ ARRAY['singing','poetry','jam','trad','comedy','storytelling','other']);
# CHECK ((lat IS NULL) = (lng IS NULL));
# INDEX GIN (activities); INDEX GIN (tags)
# INDEX GIST (location);
# UNIQUE (open_mic_id, slug)

**Event location snapshot.** The create-event page pre-fills `venue_name`, `address_line1`, `address_line2`, `postcode`, `city`, `country`, `lat`, and `lng` from the selected `OpenMics` row. `POST /events` requires `open_mic_id` and creates the event and its location snapshot in one database transaction. Location is overridden as one atomic input: the request must provide the complete address and geographic location together, including `venue_name`, `address_line1`, `address_line2`, `postcode`, `city`, `country`, `lat`, and `lng`, or provide none of them and inherit the complete parent snapshot. Partial address or coordinate overrides are rejected, and supplied coordinates must pass latitude/longitude bounds checks and the geocoding validation workflow. The generated `Events.location` then supplies the event map pin. An organizer may therefore create a one-off event at another venue, while later edits to the parent open mic never alter existing events.

Registrations
├── id (UUID)
├── event_id (FK)
├── profile_id (FK or NULL for guests, references Profiles for registered performers)
├── performer_name (guest name, required when profile_id is NULL)
├── performer_city (optional)
├── contact_email (nullable — required unless organizer_supervised; used for email confirmation, magic edit links, and user-initiated claim after sign-in)
├── contact_phone (nullable)
├── submission_channel ("organic" | "shared_link" | "email_reminder" | "social_ad" | "poster_qr" | "kiosk" | "prior" — descriptive attribution tag only; does not by itself gate visibility or claim eligibility)
├── organizer_supervised (boolean, default false — true only for registrations entered by an organizer/assistant at the event via the kiosk; the sole gate for immediate public visibility without email verification)
├── referred_by_profile_id (FK to Profiles, nullable — captures which profile's shared link the registrant followed, via a `?ref=<profile_id>` query param on the registration link; invalid/missing values are silently ignored, never rejected)
├── media_consent (boolean)
├── edit_token_hash (text, nullable — SHA-256 hash of the opaque token emailed to guests for magic-link edits; never store the raw token; UNIQUE)
├── edit_token_expires_at (timestamptz, nullable — set to event end plus 30 days; cleared on rotation or expiry)
├── email_verification_token_hash (text, nullable — SHA-256 hash of the opaque one-shot token emailed to guests to confirm ownership of contact_email; never store the raw token; UNIQUE)
├── email_verification_token_expires_at (timestamptz, nullable — set to event start + 24h, or 72h after creation for events further out)
├── verification_method ("email" | "organizer_kiosk" | "authenticated_account", nullable — records how the registration became verified)
├── email_verified_at (timestamptz, nullable — set when the guest confirms contact_email; unless organizer_supervised, a guest row is "pending" and hidden from the public roster and from claim eligibility until this is set)
├── claimed_by_account_id (FK to Accounts, nullable — set only when a signed-in account explicitly claims this guest registration; never populated automatically on Cognito email verification)
├── claimed_at (timestamptz, nullable)
├── created_at, updated_at
├── deleted_at, deleted_by_profile_id (FK, nullable), recovery_deadline
# CHECK (submission_channel IN ('organic','shared_link','email_reminder','social_ad','poster_qr','kiosk','prior'));
# CHECK (organizer_supervised = FALSE OR submission_channel = 'kiosk');   -- organizer_supervised is only ever true for kiosk-originated rows
# CHECK (organizer_supervised OR profile_id IS NOT NULL OR contact_email IS NOT NULL);
# CHECK ((claimed_by_account_id IS NULL) = (claimed_at IS NULL));
# CHECK (claimed_by_account_id IS NULL OR profile_id IS NULL);  -- claiming never silently converts a guest row into a profile registration
# CHECK (verification_method IS NULL OR verification_method IN ('email','organizer_kiosk','authenticated_account'));
# UNIQUE (event_id, profile_id) WHERE deleted_at IS NULL AND profile_id IS NOT NULL
# UNIQUE (edit_token_hash) WHERE edit_token_hash IS NOT NULL
# UNIQUE (email_verification_token_hash) WHERE email_verification_token_hash IS NOT NULL
# INDEX (contact_email) WHERE contact_email IS NOT NULL AND claimed_by_account_id IS NULL
# "My registrations" for a signed-in account = rows where profile_id IN (my profiles) OR claimed_by_account_id = my account.
# "Publicly visible / valid" = rows where organizer_supervised OR email_verified_at IS NOT NULL — applies uniformly across every non-kiosk channel (organic browsing, shared link, email reminder, social ad, poster QR); kiosk rows are visible immediately because the organizer's physical presence substitutes for email proof.
# "Claimable by me" = rows where contact_email = my Cognito-verified email AND claimed_by_account_id IS NULL AND email_verified_at IS NOT NULL — verification is required for claim regardless of channel, including kiosk rows; an unverified kiosk registration is publicly visible but can never be claimed.

Performances
├── id (UUID)
├── registration_id (FK)
├── name
├── activity ("singing" | "poetry" | "jam" | "trad" | "comedy" | "storytelling" | "other")
├── sequence (integer — order in which performers perform at the event)
├── status ("registered" | "performed" | "no_show" | "cancelled") — default "registered"
├── notes (text, nullable — organizer-only)
├── created_at, updated_at
├── deleted_at, deleted_by_profile_id (FK, nullable), recovery_deadline
# API enforces: Performances.activity must be in the effective activities set of the parent event
# (Events.activities if not NULL, else OpenMics.activities).
# CHECK (status IN ('registered','performed','no_show','cancelled'));

Media
├── id (UUID)
├── media_type ("photo" | "video")
├── event_id (FK, nullable — set when media is attached to an event)
├── performance_id (FK to Performances, nullable — attributes media to a specific performance)
├── profile_owner_id (FK, nullable — Profiles entry; set for profile-only media)
├── added_by_profile_id (FK — uploader and media owner; the uploader may delete their own media)
├── added_by_role ("performer" | "organizer" — drives grouping/display on event pages)
├── source_url (S3 URL for photos, embedded video URL for videos)
├── mime_type (nullable), size_bytes (bigint, nullable)
├── width (nullable), height (nullable), duration_seconds (nullable — videos)
├── thumbnail_url (nullable — poster frame for videos)
├── video_platform (nullable — "youtube" | "vimeo" | "instagram" | ...)
├── platform_video_id (nullable — canonical ID on that platform)
├── caption (nullable)
├── created_at, updated_at, deleted_at, deleted_by_profile_id (FK, nullable), recovery_deadline

**Media ownership and organization moderation.** `added_by_profile_id` is the uploader/owner; `profile_owner_id` identifies the profile whose page owns profile-only media and is not a substitute for uploader ownership. The uploader may delete their own media. The organizer who owns the associated open-mic profile may edit or delete any media belonging to that organization, including media uploaded by performers. Organization scope is derived from the media's event, performance registration, or profile association. Organizer authority applies to media edits and soft-deletes but does not change the uploader attribution or `added_by_role` history.

PrivateMessages
├── id (UUID)
├── sender_profile_id (FK — Profiles entry)
├── receiver_profile_id (FK — Profiles entry)
├── text
├── read_at (NULL if unread)
├── created_at, deleted_at, deleted_by_profile_id (FK, nullable), recovery_deadline

Suggestions (site-wide suggestion box — feedback about the openmics.org website/product only)
├── id (UUID)
├── account_id (FK — the account that posted the suggestion; account-scoped, not profile-scoped)
├── title
├── body (text)
├── status ("open" | "under_review" | "planned" | "in_progress" | "shipped" | "declined" | "duplicate") — default "open"
├── admin_notes (text, nullable — internal, only visible to platform admins)
├── tags text[]
├── created_at, updated_at
├── deleted_at, deleted_by_profile_id (FK, nullable), recovery_deadline
# CHECK (status IN ('open','under_review','planned','in_progress','shipped','declined','duplicate'));
# INDEX (status); INDEX GIN (tags)
# Scope: Suggestions are for site-wide product feedback ONLY (features, bugs, policy, UX).
#   - NOT for feedback about a specific open mic, event, or profile.
#   - Feedback about a specific open mic or event goes through reviews (Comments with rating on the event/open_mic).
#   - Feedback about a specific profile goes through a private message to that profile.
# There is no foreign key from Suggestions to any content entity; suggestions never reference an open_mic/event/profile id.
# Replies use `CommentSuggestions`; upvotes use `ReactionSuggestions`.
# Only platform admins may change `status` or write `admin_notes`.

Deletions (append-only journal of soft deletions across entity types)
├── id (UUID)
├── entity_type ("profile" | "open_mic" | "event" | "registration"
│                | "performance" | "media" | "private_message" | "suggestion")
├── entity_id (UUID — id of the soft-deleted row in its origin table)
├── deleted_by_profile_id (FK — Profiles entry of who deleted)
├── deleted_at
├── recovery_deadline
├── restored_at (NULL until restored; row remains for audit)
├── purged_at (NULL until hard-deleted by the purge job)
├── created_at
# INDEX (entity_type, entity_id); INDEX (deleted_at); INDEX (recovery_deadline)
# One row per soft-delete event; not the source of truth for the entity itself.

PendingS3Deletions (queue of S3 objects to delete; S3 is never deleted inline)
├── id (UUID)
├── bucket
├── object_key
├── media_id (FK to Media, nullable — original media row if still known)
├── reason ("purge" | "replace" | "abandoned_upload" | "manual")
├── scheduled_for (when the S3 delete worker may process this row)
├── attempts (integer, default 0)
├── last_error (nullable)
├── created_at
├── processed_at (NULL until the S3 object has been deleted)
# INDEX (processed_at, scheduled_for); INDEX (bucket, object_key)

Notifications (in-app inbox + email debounce state; one row per notifiable event)
├── id (UUID)
├── recipient_profile_id (FK — Profiles entry the notification is for)
├── type ("private_message" | "comment" | "reply" | "reaction" | "review" | "review_response")
├── actor_profile_id (FK, nullable — Profiles entry that triggered it; NULL for system-generated)
├── entity_type ("private_message" | "comment" | "reaction" — origin table of entity_id; redundant with `type` but stored so any consumer can resolve the origin table without duplicating the type→table mapping; a CHECK constraint pins the pairing so it can never drift from `type`)
├── entity_id (UUID — id of the row in its origin table; enforced in app layer)
├── preview (text, nullable — short denormalized snippet for display, e.g. message/comment excerpt)
├── read_at (timestamptz, nullable — set when the recipient views the source content, not merely the inbox list)
├── email_required (boolean, default true — false for types that are in-app only)
├── email_sent_at (timestamptz, nullable — set atomically by the debounce sweep when it claims the row for sending)
├── created_at
# CHECK (type IN ('private_message','comment','reply','reaction','review','review_response'));
# CHECK (entity_type IN ('private_message','comment','reaction'));
# CHECK (                                                            -- entity_type is derived from type; this pins the pairing so the two columns can never disagree
#   (type = 'private_message' AND entity_type = 'private_message')
#   OR (type IN ('comment','reply','review','review_response') AND entity_type = 'comment')
#   OR (type = 'reaction' AND entity_type = 'reaction')
# );
# INDEX (recipient_profile_id, read_at) WHERE read_at IS NULL              -- unread list + unread count
# INDEX (email_required, email_sent_at, created_at) WHERE read_at IS NULL AND email_required AND email_sent_at IS NULL  -- debounce sweep
```

**Notification read state and email debounce:**
- `Notifications.read_at` reflects the recipient having viewed the *specific source content* (opened the conversation thread, viewed the commented media, etc.), not merely having the inbox list open. The handler that marks source content read (e.g. `PUT /messages/:id/mark-read`) also sets `read_at` on the corresponding `Notifications` row(s) in the same transaction.
- A scheduled sweep (EventBridge, every 1 minute) claims and sends debounced email notifications atomically to avoid double-sends across overlapping runs:
  ```sql
  UPDATE Notifications
  SET email_sent_at = now()
  WHERE id IN (
    SELECT id FROM Notifications
    WHERE read_at IS NULL
      AND email_required
      AND email_sent_at IS NULL
      AND created_at <= now() - interval '5 minutes'
    ORDER BY created_at
    LIMIT 500
    FOR UPDATE SKIP LOCKED
  )
  RETURNING *;
  ```
  Rows returned by this statement are enqueued to the email SQS queue; the `UPDATE` is the only place `email_sent_at` is set, so a row can never be claimed twice even if two sweep invocations overlap.
- The 5-minute debounce threshold and the 1-minute sweep cadence are independent knobs: the cadence only bounds how promptly a stale unread notification is picked up, not the debounce window itself.
- This mechanism generalizes across all `Notifications.type` values (comments, reviews, reactions, private messages), not just messages — each source-content "mark read" handler is responsible for updating its corresponding `Notifications` rows.

**Soft-delete / recycle bin model:**
- Every soft-deletable table (`Profiles`, `OpenMics`, `Events`, `Registrations`, `Performances`, `Media`, `PrivateMessages`, and `Suggestions`) carries `deleted_at`, `deleted_by_profile_id`, and `recovery_deadline`. `Comments` and `Reactions` are not soft-deleted.
- Reads filter on `deleted_at IS NULL`; restore = `UPDATE ... SET deleted_at = NULL, deleted_by_profile_id = NULL, recovery_deadline = NULL` and set `Deletions.restored_at = now()`.
- Unified recycle bin UI is served from the `Deletions` journal: one row is appended on every soft-delete, with `entity_type` + `entity_id` pointing back to the origin table for details.
- A scheduled EventBridge purge job hard-deletes origin rows where `recovery_deadline < now()` and sets `Deletions.purged_at`.
- For `Media`, the purge job does **not** delete the S3 object directly. It inserts a row into `PendingS3Deletions` (with `reason = "purge"`); a separate S3 delete worker processes that queue.
- Soft-deleting an associated entity does not delete its comments or reactions; visibility queries exclude them while the associated entity is hidden, and restoration makes them visible again.
- Hard-deleting an `OpenMics`, `Events`, `Media`, `PrivateMessages`, or `Suggestions` row cascades through its typed comment/reaction association tables. Hard-deleting a `Comments` row cascades to its `CommentComments` replies and all reaction associations targeting that comment. No comment or reaction remains attached to a fully deleted entity.
- Any `UNIQUE` constraint that should ignore deleted rows (e.g., unique registration per event+profile) is a partial unique index `WHERE deleted_at IS NULL`.
- Partial index `WHERE deleted_at IS NOT NULL` on each soft-deletable table keeps hot reads clean.

**Account lifecycle, retention, and deletion policy:**
- Account deletion uses a two-stage lifecycle: immediate disable plus a default 30-day recovery window, with an allowed 90-day maximum for edge cases or abuse investigation. The default is intentionally short enough to avoid indefinite retention while still permitting user reversal of an accidental action.
- During the recovery window, the user may request a data export and may restore a deleted account or profile if the platform allows restoration. Login and account-level write operations are blocked immediately after deletion request, while public profile visibility is reduced to a neutral "deleted account"/"former member" label for history-bearing public content.
- Final purge removes personal data, access credentials, and non-essential profile metadata once the retention window closes; remaining public content is either anonymized or left with neutral attribution only where historical continuity is required.
- Immutable audit records, moderation events, security incidents, and compliance artifacts are retained in a separate immutable log stream and are never deleted, but they are keyed by anonymized references rather than live account identifiers wherever possible.
- Export data includes account/profile metadata, event and registration history, media references, and notification records in a portable format; it is generated before purge and is not included in the public-facing history log.
- Notification email policy defaults are fixed in MVP: 5-minute unread debounce for outbound emails, 1-minute sweep cadence, and a conservative per-account send rate limit of 1 email/sec with a burst guard for SES. `NotificationPreferences` remain explicitly deferred unless product validation shows a clear need after launch.

**MVP authorization scope:**
- Multi-admin collaboration is post-MVP. During MVP, the account in `Profiles.created_by_account_id` is the sole owner and the only account that can manage that profile's open mics, events, registrations, media, and settings.
- MVP authorization checks the authenticated account against `created_by_account_id` for profile-scoped mutations; platform admins retain their platform-level bypass.
- `Roles`, `Permissions`, `RolePermissions`, `AccountProfileRoles`, and `ProfileInvitations` are reserved for the post-MVP collaboration release. They are not required on MVP request paths, and invitations, membership changes, team quotas, and role-management UI are excluded from the MVP delivery plan.

**Post-MVP permission-based design:**
- **Profiles** no longer have a type; instead, what a profile "can do" is determined by the roles assigned to accounts via `AccountProfileRoles`.
- **Accounts** have roles (Owner, Admin, Assistant, Performer, Organizer, etc.) on specific profiles via `AccountProfileRoles`.
- **Roles** map to fine-grained `Permissions` via `RolePermissions`.
- **Owner** (account that created the profile) can do anything, including delete the profile.
- **Admin** can do most things except delete.
- **Assistant** can perform limited actions like collecting registrations at events.
- Permissions are queryable in the UI and checked on all API calls.

**Platform admin (super user):**
- `Accounts.is_platform_admin` flag indicates platform-level super users
- Platform admins bypass profile-level permission checks
- Can manage system-level resources (roles, permissions, user accounts, platform settings)
- API check: if `account.is_platform_admin`, grant all operations; else, check profile-scoped roles via `AccountProfileRoles`

**Context and permissions flow:**
1. Account logs in, sets current profile via `current_profile_id` in Accounts table
2. For any action, API first checks `is_platform_admin`:
   - If true, allow (or enforce platform-specific permission checks if needed)
   - If false, look up `AccountProfileRoles(account_id, profile_id)`
3. API resolves roles → permissions via `RolePermissions` and `Permissions` tables
4. API enforces permission checks before processing requests
5. Frontend queries `GET /profiles/:id/roles` to display UI elements based on user's permissions; all API calls use the `/api` base URL defined in [`openapi.yaml`](../openapi.yaml).

**Permission enforcement design (server side):**

The rules above describe *what* is checked; this subsection specifies *how* the API enforces it in a way that stays fast under load and closes the common authorization pitfalls (IDOR, stale JWTs, list-endpoint over-fetch).

Five design principles:

1. **Server is authoritative, UI is UX.** Every allow/deny decision is re-made server-side on every request. The client's rendered state is never trusted.
2. **Two-layer check on every mutation.** *Layer A* — does the caller hold permission `P`? *Layer B* — does the target resource belong to the profile scope where they hold it? Skipping B is the classic IDOR bug.
3. **Permissions are code, not strings.** The `Permissions` table is for admin UI and audit; the canonical list is a TypeScript enum, and the DB is seeded from it. Typos become compile errors and OpenAPI exports the enum for the frontend.
4. **Cache the resolved set, not the joins.** Compute `Permissions(account, profile) → Set<PermissionKey>` once per request context; reuse across handlers and response shaping.
5. **404 for unauth reads of non-public resources, 403 for unauth writes and public reads.** Don't leak resource existence through 403s.

**Request pipeline (Fastify).** A single `preValidation` plugin builds a `request.ctx` per request with `accountId`, `isPlatformAdmin`, `currentProfileId`, and an async `permissionsFor(profileId)`. `permissionsFor` reads from an in-process LRU keyed on `(accountId, profileId)`; on miss it issues one indexed join:

```sql
SELECT p.key
FROM AccountProfileRoles apr
JOIN RolePermissions rp ON rp.role_id = apr.role_id
JOIN Permissions p       ON p.id      = rp.permission_id
WHERE apr.account_id = $1 AND apr.profile_id = $2
```

Under load the LRU covers >95% of requests, so this query is cold path (~1–2 ms) and the hot path is a Set lookup (~10 µs).

**Declarative route metadata.** Route definitions carry the required permission and a scope resolver; a shared `authorize` `preHandler` reads them and runs both layers:

```ts
fastify.route({
  method: 'PUT',
  url: '/events/:id',
  config: { requires: { permission: 'events:manage', scope: 'event' } },
  preHandler: authorize,
  handler: updateEvent,
})
```

`scope: 'event'` tells `authorize` to derive the owning `profile_id` from the URL params (`events` → `profile_id`, `openMics` → `profile_id`, `registrations` → the event's `profile_id`). Layer B is what stops a caller who holds `events:manage` on profile X from mutating an event on profile Y.

**Platform-admin short-circuit.** `is_platform_admin` is sourced from the DB inside `permissionsFor`, **never trusted from a JWT claim** — Cognito ID tokens live too long (up to an hour) for a revoked admin to be safely bounced by token expiry alone. If true, `authorize` skips both layers.

**Cache invalidation.** Any write to `AccountProfileRoles`, `RolePermissions`, `Roles`, or `Accounts.is_platform_admin` publishes a `permissions:invalidate` message via Postgres `LISTEN`/`NOTIFY`; every Fastify process subscribes and drops matching LRU entries. TTL (60 s) is the safety net if the channel drops a message.

**List endpoints filter in SQL.** For "events I can manage" and similar, embed the permission predicate directly (`WHERE profile_id IN (SELECT profile_id FROM AccountProfileRoles WHERE account_id = $1 AND role_id IN (:roles_with_permission))`). Never fetch-then-filter — that scales with total row count instead of the caller's role fan-out.

**Response envelope carries permission state.** On success, mutation and detail responses include `X-Current-Profile-Permissions: events:manage,registrations:collect,…` so the frontend can refresh its cache without a separate round trip. On failure, the standard error envelope carries `code: PERMISSION_DENIED` with the missing key.

**Audit log.** Any action gated by `roles:*`, `profiles:manage_roles`, or a platform-admin route writes an `AuditLog` row (actor, action, target, before/after) inside the same transaction as the mutation. Non-privileged actions do not — that would be write amplification.

**Throughput & footprint.** With an LRU of `active_users × active_profiles_per_user × ~200 bytes`, the process resident set for permission caching stays in single-digit MB even at a few hundred thousand concurrent sessions. Pub/sub invalidation carries a few messages per minute in steady state.

**Threats explicitly addressed:** stale-token abuse after role revocation (DB-sourced, not JWT-sourced), IDOR across profile scopes (Layer B), enumeration of private resources via 403 (404 policy), and races between a mutation and a concurrent role change (permission set is re-read inside the mutation's transaction before commit).

**Non-goals for v1.** No ABAC / policy engine (OPA, Cedar) — the current permission catalog doesn't need attribute rules. No delegated tokens or scoped API keys — no third-party read access yet. No field-level permission stripping — currently handled by response shaping per role; formalize only if the matrix grows.

**Event media attribution note:** `Media.added_by_role` ("performer" | "organizer") is inferred from the roles an account has on the profile that added the media, driving display grouping on event pages.

**Rating aggregation (`OpenMics` and `Events`):**
- `rating_avg` and `rating_count` are denormalized so directory, event, and series pages do not calculate `AVG` on every request.
- A single review-aggregation trigger on `Comments` and the typed review associations handles `INSERT`, `UPDATE` (rating or target change), and hard-delete. It recomputes the affected `OpenMics` rows through `CommentOpenMics` and `Events` rows through `CommentEvents` whenever `rating IS NOT NULL`.
- The trigger recomputes from source `Comments` rows rather than incrementing counters, making it idempotent and allowing backfilling with explicit `UPDATE OpenMics` and `UPDATE Events` statements.
- Soft-deleting an open mic or event excludes its reviews from reads and aggregate queries without deleting the reviews; restoring it makes the reviews and aggregates visible again.

**Directory listing rules (`GET /open-mics`, `GET /open-mics/map`):**
- Every open mic must have an owning `profile_id` at creation — the caller's current profile becomes the owner. There is no unclaimed / third-party-listing state in v1; ownership verification is deferred.
- The directory excludes rows with `status IN ('draft','ended')` and `deleted_at IS NOT NULL`. `paused` rows are still returned with a visible "On break" indicator so the entry doesn't disappear from search when the organizer takes a temporary hiatus.
- Guest registration claiming applies only to event `Registrations` — there is no equivalent "claim an open mic" flow. Ownership transfer between profiles is a manual admin operation for now.

**Registration flows (self-serve with email confirmation, walk-in kiosk, user-initiated guest claim, magic-link editing):**
- All frontend entry points share the same `POST /events/:id/registrations` endpoint; `submission_channel` is a descriptive attribution tag only (`"organic"`, `"shared_link"`, `"email_reminder"`, `"social_ad"`, `"poster_qr"`, `"kiosk"`), and `organizer_supervised` is the only field that changes verification/visibility behavior.
- **Self-serve** (public): any visitor to `/events/:eventId/register`, regardless of whether they arrived by organic browsing, a shared link, an email reminder, a social ad, or a poster QR code — the page and the verification rule are identical across all of these. If signed in, the caller must select a separate account-owned profile with `profile_kind='performer'`; the registration is immediately valid with `verification_method='authenticated_account'`. An organizer may register for their own event only after creating and selecting such a performer profile; the organizer profile itself cannot be used as the performer identity. Organizer permissions do not bypass capacity, ordering, visibility, or verification rules. If the account has no performer profile, the UI offers inline performer-profile creation. If not signed in, the visitor supplies `performer_name` and a **required** `contact_email`; the row is created with `email_verified_at IS NULL` (pending) and is excluded from the public roster and from event roster caps until confirmed.
- **Email confirmation for self-serve guests:** on create, the API generates a one-shot `email_verification_token`, stores only its SHA-256 hash plus `email_verification_token_expires_at`, and enqueues an email with a link to `https://openmics.org/events/:eventId/register/verify?token=<verification_token>`. `POST /registrations/:id/verify-email` hashes the supplied token, compares it in constant time, sets `email_verified_at` and `verification_method='email'`, then clears the hash and expiry before triggering the standard post-registration flow (including the magic edit-link email). Pending rows past a TTL (event start + 24h, or 72h after creation for events further out) are hard-deleted by a background sweep so no unconfirmed row lingers as a claimable target.
- **Walk-in kiosk** (organizer/assistant only, `organizer_supervised=true`): requires `registrations:collect` permission on the event's open-mic profile. The kiosk page loops — register a performer, confirm, reset the form for the next walk-in. The registration is publicly visible immediately regardless of email state, because the organizer's physical presence substitutes for email proof. Set `verification_method='organizer_kiosk'` at creation. If `contact_email` is supplied (optional for kiosk rows), the API also sends a one-shot verification email using the hashed token flow; a later successful confirmation changes the method to `email`. If the attendee never confirms, the method remains `organizer_kiosk`, and the row cannot be claimed until email verification occurs. The kiosk UI encourages every walk-in to supply and verify an email, explaining the concrete benefit: only a verified email lets them later find and claim this exact attendance from their own account.

- **Magic-link editing:** on registration create (once publicly visible — i.e. after email confirmation for self-serve, immediately for kiosk), if `contact_email` is set, the API generates a random opaque `edit_token`, stores only its SHA-256 hash plus `edit_token_expires_at`, and enqueues an email containing a link like `https://openmics.org/events/:eventId/register?token=<edit_token>`. The resolve endpoint is rate-limited per IP and registration, never logs or echoes the raw token, returns `Cache-Control: no-store` and `Referrer-Policy: no-referrer`, and exchanges a valid URL token for a short-lived, HttpOnly, Secure, SameSite=Lax edit-session cookie. The browser then uses that cookie for `GET`/`PUT` of the specific registration; raw URL tokens are not retained in application state or sent to downstream pages. Tokens are valid until the event ends + 30 days, after which the hash and expiry are cleared. They can be rotated by the owner or an organizer via `POST /registrations/:id/rotate-edit-token`, which invalidates the previous hash immediately. Access-token values are redacted from application, access, analytics, and email-provider logs.
- **User-initiated guest → account claim:** a signed-in account calls `GET /me/claimable-registrations` to list guest registrations where `contact_email` matches the account's Cognito-verified email, `claimed_by_account_id IS NULL`, and `email_verified_at IS NOT NULL` — this verification requirement applies uniformly to every channel, including kiosk rows, so an unverified walk-in registration can never be claimed later no matter how it was entered. The client offers a per-row **Claim** action (and optionally "Claim all") that calls `POST /registrations/:id/claim`; the server re-checks the email match against the caller's verified identity, then sets `claimed_by_account_id` and `claimed_at`. `profile_id` remains `NULL` — the registration stays guest-attributed on public listings but appears in the claiming account's "My registrations" list. **Claim is never triggered by Cognito email verification alone**; the user must open the claim UI and confirm the row(s).
- **Referral attribution:** any shareable public page — event detail, event register, open-mic detail/register, or profile detail — may carry `?ref=<profile_id>` identifying the profile whose share link was followed (e.g. a performer forwarding an event link to a friend). The client captures this from whichever page it first appears on (not only the register page), persists it locally, and attaches it to whichever conversion happens next:
  - **Registration:** resolved to `Registrations.referred_by_profile_id` on `POST /events/:id/registrations`.
  - **Account sign-up:** when the visitor begins the Cognito hosted-UI flow, the client places the stored referral in a signed, single-use OAuth `state` value bound to the browser's auth nonce. After Cognito returns successfully, Fastify validates and consumes that state while it first provisions the application `Accounts` row, setting `referred_by_profile_id` and `referred_at` in the same transaction. There is no follow-up referral endpoint and no period in which a newly created account can be retrospectively attributed.
  - An unrecognized, expired, or missing `ref` value is always silently ignored on both paths rather than rejected — the referred link must keep working even if the referrer's profile is later renamed, hidden, or deleted, and a bad value never blocks registration or sign-up.

**Smart registration links and QR codes (event-specific and "next scheduled event"):**
- **Event-specific link/QR:** `/events/:eventId/register` (existing) — always points at one fixed event, for posters printed after a specific date is confirmed.
- **Open-mic "next event" link/QR:** `GET /open-mics/:id/register` (and its vanity form `/@:handle/register`) is a durable link an organizer can put on a permanent poster or flyer once and never reprint. The server resolves it via `GET /open-mics/:id/next-event` (public, cacheable) to the soonest upcoming, not-yet-closed event under that open mic and forwards the visitor to that event's `/events/:eventId/register` page. If no upcoming event exists, the page renders a fallback instead of a broken link or 404: the open mic's `schedule_summary` (and `schedule_details` if present), telling the visitor plainly when the next event is expected (e.g. "No event is currently open for registration. This open mic usually runs: Every 2nd Tuesday, 8pm.").
- Both link forms accept the `?ref=<profile_id>` referral parameter described above and carry it through the server-side redirect.
- The organizer console exposes one-tap **Copy link** and **Download QR code** actions for both link types, so a non-technical organizer can hand out a scannable poster or share a link without understanding the underlying resolution logic.
- The organizer's kiosk view is served by `GET /events/:id/registrations` filtered by permission, and the kiosk's "view all / edit" buttons target `PUT /registrations/:id` — same as any organizer edit.

**Plans & quotas (MVP simplified model):**
- `Accounts.plan` (`"free" | "pro"`, default `"free"`) is the only billing/quota state we store for now. No `Plans`, `Subscriptions`, or `UsageCounters` tables yet.
- Limits and features live as a constants map in code (`src/config/plans.js`), so changing a threshold is a code change, not a migration:
  ```js
  export const PLAN_LIMITS = {
    free: {
      media_bytes:             5 * 1024 ** 3,   // 5 GB
      media_count:             500,
      profiles:                1,               // profiles per account (open-mic or performer identities)
      open_mics:               1,               // open-mic series per organizer profile
      events_per_month:        10,
      registrations_per_event: 50,
      team_size:               4,               // accounts with roles on a single profile
      features:                [],
    },
    pro: {
      media_bytes:             500 * 1024 ** 3, // 500 GB
      media_count:             50_000,
      profiles:                100,
      open_mics:               100,
      events_per_month:        1_000,
      registrations_per_event: 500,
      team_size:               100,
      features:                ['custom_theme', 'unlisted_profile', 'csv_export'],
    },
  };
  ```
- Pro is assigned manually (by a platform admin) to developer, staff, or partner accounts until self-serve billing exists.
- A `checkQuota(account, dimension, delta)` middleware runs on every write path. For profile-scoped dimensions (team_size, open_mics, events_per_month, registrations_per_event, media_bytes, media_count) it resolves to the **owner account of the profile being written to** — team members do not consume their own quota on someone else's profile.
- Usage is computed on-demand (SUM/COUNT on source tables such as `Media.size_bytes`); no denormalized counters yet. Cache per-profile results in memory for a short TTL if a hot endpoint becomes chatty.
- Every write response includes `X-Quota-<Dimension>-Used` and `X-Quota-<Dimension>-Limit` headers for the primary dimension it touched, so the frontend can render meters and upgrade CTAs.
- Migration path when we start charging: (1) create `Plans` table and seed one row per current `plan` key; (2) move `PLAN_LIMITS` into `Plans.limits JSONB` and delete the constants file; (3) create `Subscriptions`, backfill one row per account from `Accounts.plan`, then drop `Accounts.plan`; (4) add Stripe fields to `Subscriptions` and the `/webhooks/stripe` endpoint; (5) add `UsageCounters` only if live SUM/COUNT stops being fast enough.

---

## 5) API Architecture

**Canonical contract:** [`openapi.yaml`](../openapi.yaml)

**Base URL:** `https://api.openmics.org/api` (all JSON and SSE API operations are below the `/api` root)

The Fastify service serves the same contract at `GET /api/openapi.json`. Paths in the endpoint inventory below are relative to the base URL, so for example `GET /open-mics` is served at `GET https://api.openmics.org/api/open-mics`. Public HTML documents such as `/@:handle` remain outside the API root and are routed by CloudFront to the Fastify HTML origin.

**Core Resources:**

```
Authentication
  POST   /auth/sign-up            (starts Cognito hosted-UI sign-up; accepts the client-generated, signed OAuth state containing an optional referral and provisions the application Account with that referral after the validated callback)
  POST   /auth/sign-in            (delegates to Cognito)
  POST   /auth/refresh-token
  GET    /auth/profile            (current user)

Public documents (CloudFront origin for canonical handle URLs)
  GET    /@:handle                (public HTML document: escaped metadata, canonical URL, and SPA entry script)
  GET    /@:handle/events/:id     (public HTML document for an event under an open-mic handle)

Profiles (unified context management)
  GET    /accounts/:id/profiles           (list all profiles for current user with their roles)
  GET    /profiles/slug-available?slug=<candidate>   (check global profile slug availability)
  GET    /profiles/:id                    (view profile details — public or private based on permissions)
  POST   /profiles                        (create new profile)
  PUT    /profiles/:id                    (update profile — permission: profiles:edit)
  DELETE /profiles/:id                    (delete profile — permission: profiles:delete, owner only)
  PUT    /accounts/:id/current-profile    (set which profile user is currently using)
  POST   /profiles/:id/media              (add media to profile)
  GET    /profiles/:id/media              (get profile-only media)

Profile Follows ("likes")
  POST   /profiles/:id/follow             (current profile starts following :id)
  DELETE /profiles/:id/follow             (current profile unfollows :id)
  GET    /profiles/:id/followers          (list profiles that follow :id)
  GET    /profiles/:id/following          (list profiles :id follows)
  GET    /me/following/upcoming-events    (upcoming events from every profile the current profile follows;
                                           supports ?limit=&from=&to=; ordered by date/time ascending)

Profile Access Management
  GET    /profiles/:id/members            (list all accounts and their roles — permission: profiles:manage_roles)
  POST   /profiles/:id/invitations        (invite account with role — permission: profiles:manage_roles)
  GET    /profiles/:id/invitations        (list pending invitations — permission: profiles:manage_roles)
  PUT    /invitations/:id                 (accept/reject invitation by recipient)
  DELETE /profiles/:id/members/:account_id  (remove account's access — permission: profiles:manage_roles)
  PUT    /profiles/:id/members/:account_id/role  (change account's role — permission: profiles:manage_roles)

Roles & Permissions (post-MVP, platform admin only)
  GET    /roles                           (list all roles)
  GET    /permissions                     (list all permissions)
  POST   /roles                           (create new role — permission: roles:create)
  PUT    /roles/:id                       (update role — permission: roles:edit)
  GET    /roles/:id/permissions           (list permissions for a role)
  POST   /roles/:id/permissions           (add permission to role — permission: roles:edit)
  DELETE /roles/:id/permissions/:perm_id  (remove permission from role — permission: roles:edit)

OpenMics (directory + management)
  GET    /open-mics                  (directory search — see "Directory search & map endpoints" below)
  GET    /open-mics/map              (map view: pins or clusters within a bounding box)
  POST   /open-mics                  (authenticated; the caller's current profile becomes the owning organizer profile)
  GET    /open-mics/slug-available?slug=<candidate>   (check global slug availability)
  GET    /open-mics/:id
  PUT    /open-mics/:id
  GET    /open-mics/:id/events
  GET    /open-mics/:id/next-event    (public; the soonest upcoming, not-yet-closed event under the series, or null + schedule_summary/schedule_details fallback; powers the durable "next event" QR/link)
  GET    /open-mics/:id/register      (public HTML; resolves to the next event's register page via /open-mics/:id/next-event, or renders the schedule_summary fallback if none exists; also served at the vanity form /@:handle/register)
  GET    /open-mics/:id/events/slug-available?slug=<candidate>   (check per-series event slug availability)
  GET    /open-mics/:id/reviews
  POST   /open-mics/:id/reviews   (registered users only)

Events
  GET    /events/upcoming         (public; ordered by date/time ascending; supports ?near=<lat>,<lng>&radius_km=&limit=&from=&to=; used by the directory home "Upcoming events" section)
  GET    /events/:id
  POST   /events                  (organizer only; requires open_mic_id; defaults location from the open mic but accepts location overrides for a one-off venue)
  PUT    /events/:id
  GET    /events/:id/registrations                (organizer/assistant view of the roster; also backs the walk-in kiosk state)
  POST   /events/:id/registrations                (self-serve or kiosk; body sets submission_channel, organizer_supervised, referred_by_profile_id, contact_email, etc.)
  GET    /events/:id/reviews
  POST   /events/:id/reviews
  GET    /events/:id/media         (grouped by added_by_role: organizer | performer)
  POST   /events/:id/media         (organizer or registered performer, using current profile)

Registrations
  GET    /registrations/:id                        (owner — profile or claiming account — or organizer/assistant of the event)
  GET    /registrations/edit?token=<edit_token>    (magic-link resolve for guest edits; no auth required)
  PUT    /registrations/:id                        (owner or organizer/assistant, or the short-lived edit session established by the magic-link resolver)
  POST   /registrations/:id/rotate-edit-token      (owner or organizer/assistant; invalidates the previous magic link and emails a new one)
  POST   /registrations/:id/verify-email           (public; body/query carries the one-shot verification token; flips a pending self-serve guest row to valid)
  POST   /registrations/:id/claim                  (authenticated; claims a guest registration whose contact_email matches the caller's Cognito-verified email)
  GET    /registrations/:id/performances

Me
  GET    /me/claimable-registrations               (authenticated; lists unclaimed guest registrations whose contact_email matches the caller's Cognito-verified email, excluding pending self-serve rows)
  GET    /me/home/upcoming-events                  (authenticated; personalized upcoming-events feed for the directory home — prioritizes followed profiles, prior registrations, and attended open mics; falls back to nearest then soonest globally; supports ?near=&limit=)
  GET    /me/home/notable-open-mics                (authenticated; personalized "notable open-mics" feed with the same priority order and fallbacks; supports ?near=&limit=)

Performances
  POST   /performances             (create performance for a registration)
  PUT    /performances/:id
  DELETE /performances/:id

Media
  GET    /media/:id
  POST   /media/upload-url        (presigned upload URL)
  POST   /media                   (create media record, associated with current profile)
  DELETE /media/:id               (soft delete)
  POST   /media/:id/recover       (from recycle bin, using current profile)
  GET    /media/:id/comments
  POST   /media/:id/comments      (using current profile)
  GET    /media/:id/reactions
  POST   /media/:id/reactions     (using current profile)

Comments
  GET    /comments/:id
  PUT    /comments/:id             (edit text/rating; author only)
  DELETE /comments/:id
  POST   /comments/:id/replies    (using current profile)

EventReviews
  GET    /events/:id/reviews/:reviewId
  PUT    /events/:id/reviews/:reviewId              (edit text/rating; reviewer only)
  DELETE /events/:id/reviews/:reviewId
  POST   /events/:id/reviews/:reviewId/responses   (organizer's profile only)

OpenMicReviews
  GET    /open-mics/:id/reviews/:reviewId
  PUT    /open-mics/:id/reviews/:reviewId              (edit text/rating; reviewer only)
  DELETE /open-mics/:id/reviews/:reviewId
  POST   /open-mics/:id/reviews/:reviewId/responses   (organizer's profile only)

PrivateMessages
  GET    /messages                (inbox for current profile)
  POST   /messages/:profile_id    (send from current profile to recipient profile)
  GET    /messages/:profile_id    (conversation with specific profile)
  PUT    /messages/:id/mark-read

Suggestions (site-wide suggestion box — platform/product feedback only, never about a specific open mic, event, or profile)
  GET    /suggestions                         (list; supports ?status=&tag=&sort=top|new; public read)
  POST   /suggestions                         (authenticated account posts a suggestion)
  GET    /suggestions/:id                     (view a suggestion)
  PUT    /suggestions/:id                     (edit title/body/tags — author only)
  PATCH  /suggestions/:id/status              (change status — platform admin only)
  PUT    /suggestions/:id/admin-notes         (update admin_notes — platform admin only)
  DELETE /suggestions/:id                     (soft delete — author or platform admin)
  GET    /suggestions/:id/replies             (list replies through CommentSuggestions)
  POST   /suggestions/:id/replies             (add a reply, using current profile)
  GET    /suggestions/:id/reactions           (upvotes)
  POST   /suggestions/:id/reactions           (upvote, using current profile)

Notifications
  GET    /notifications/stream    (SSE endpoint)
  GET    /notifications           (unread list)
  PUT    /notifications/:id/read
```

**Error Response Format:**
```json
{
  "error": {
    "code": "VALIDATION_ERROR",
    "message": "Invalid input",
    "details": [{"field": "email", "reason": "already_exists"}]
  }
}
```

Quota errors use the same envelope with a stable `code` so the frontend can catch them uniformly:
```json
{
  "error": {
    "code": "QUOTA_EXCEEDED",
    "message": "Storage limit reached.",
    "dimension": "media_bytes",
    "current": 5368709120,
    "limit": 5368709120,
    "upgrade_url": "https://openmics.org/billing"
  }
}
```

**Rate Limiting:**
- 100 requests/min per user (CloudWatch + API Gateway rules later)
- 10 requests/min for media uploads

**Directory search & map endpoints:**

`GET /open-mics` — the directory query, used by the public directory home and any "browse open mics" surface. All params are optional and combine freely:

- `q` — full-text against `name`, `description`, `venue_name`, `city`, `schedule_summary`. Uses Postgres's `simple` tsvector config for now (language-agnostic; localization is deferred).
- `country=IE`, `city=Cork` — exact match.
- `activity=singing,poetry` — matches when `OpenMics.activities` overlaps the requested set (`&&` on the GIN index).
- `tag=all-ages,acoustic` — same shape on `OpenMics.tags`.
- `near=<lat>,<lng>&radius_km=<n>` — `ST_DWithin(location, ST_MakePoint(lng, lat)::geography, radius_km*1000)`. Uses the GIST index on `OpenMics.location`.
- `min_rating=<0..5>` — filters on `rating_avg`.
- `registration_mode=on_platform|external|any` — `on_platform` returns rows where `registration_mode IN ('pre_only','on_night_only','both')`; `external` returns only `registration_mode='external'`; default `any`.
- `sort=nearest|rating|recent|updated|popular` — default is `nearest` when `near=…` is set, otherwise `recent`. `recent` sorts by `created_at DESC` (newest listings first — used by the home page "Notable open-mics" section). `updated` sorts by `updated_at DESC` (a signal of active organizer management). `popular` sorts by `rating_avg` weighted by `log(rating_count + 1)` so a 5-star listing with one review doesn't outrank a 4.6-star listing with fifty.
- `page`, `page_size` — page/limit for MVP; cursor pagination if the list grows.

Always excludes `status IN ('draft','ended')` and `deleted_at IS NOT NULL`. `paused` rows are returned with an `on_break: true` flag so cards can show "On break" without dropping the entry from search results. Response items are a summary shape (`{ id, handle, name, city, country, rating_avg, rating_count, activities, tags, schedule_summary, registration_mode, entry_fee_amount, entry_fee_currency, entry_fee_note, primary_photo_url, distance_km? }`) — deliberately smaller than `GET /open-mics/:id` so the list renders fast.

`GET /open-mics/map` — for the interactive map on the directory home:

- `bbox=<west>,<south>,<east>,<north>` — required; longitude/latitude bounding box.
- `zoom=<0..20>` — required; drives the pins-vs-clusters decision.
- Filters: `activity`, `tag`, `min_rating`, `registration_mode` — same semantics as the search endpoint.

Response shape depends on zoom:
- **High zoom (≥ 12, roughly city level):** array of individual pins `{ id, handle, name, lat, lng, activities, rating_avg }`, capped at a few hundred. If the bbox contains more, the response includes `truncated: true` and the client falls back to the cluster view.
- **Lower zoom:** aggregated clusters computed server-side via `ST_ClusterKMeans` (or a grid snap for very large result sets). Each cluster returns `{ lat, lng, count, sample_ids }`; `sample_ids` powers the fly-out preview when a cluster is clicked.

Both endpoints send `Cache-Control: public, max-age=60`; the edge layer warms fast, invalidation on write is unnecessary because the URL varies by query string and 60 s freshness is well inside product tolerance.

**Home page feed rules (`/` directory home):**

The public `/` route lays out two sections — **Upcoming events** and **Notable open-mics**, five cards each — above the interactive map and search surface. The endpoint powering each section switches based on auth and geolocation permission:

| State | Upcoming events source | Notable open-mics source |
|---|---|---|
| Anonymous, location off | `GET /events/upcoming?limit=5` | `GET /open-mics?sort=recent&limit=5` |
| Anonymous, location on  | `GET /events/upcoming?near=<lat>,<lng>&radius_km=100&limit=5` | `GET /open-mics?near=<lat>,<lng>&sort=nearest&limit=5` |
| Signed in, location off | `GET /me/home/upcoming-events?limit=5` | `GET /me/home/notable-open-mics?limit=5` |
| Signed in, location on  | `GET /me/home/upcoming-events?near=<lat>,<lng>&limit=5` | `GET /me/home/notable-open-mics?near=<lat>,<lng>&limit=5` |

Both sections render an empty state on zero rows ("No upcoming events" / "No open mics found") and each renders independently — a slow or empty query in one section never blocks the other.

**Personalization for signed-in requests** (`/me/home/*`). The server scores every candidate row against the caller's account/profile context using four EXISTS-style predicates and sorts on those signals before falling back to distance/recency. Signals evaluated:

1. **Followed** — the open mic's owning organizer profile is followed by any of the caller's profiles (`ProfileFollows`).
2. **Registered** — the caller has any `Registrations` row for an event on this open mic, resolved via `profile_id IN (my profiles) OR claimed_by_account_id = my account`.
3. **Attended** — a `Performances` row with `status='performed'` exists on any of the caller's registrations for this open mic.
4. **Distance** — `ST_Distance(location, near)` when a `near` param is provided; NULL otherwise.
5. **Recency** — `created_at` for open mics, `date` for events.

Sort order: `is_followed DESC, has_registered DESC, has_attended DESC, dist_m ASC NULLS LAST, recency`. A single CTE-backed query builds the score set from the base table plus the three EXISTS predicates — cheap enough to serve inline without cache warming. A brand-new signed-in account with no signals degrades naturally to distance/recency — the same output an anonymous caller with the same location settings would get.

**Location handling.** The client requests `navigator.geolocation.getCurrentPosition()` behind a small explanatory prompt on first visit, caches the result in `sessionStorage` for the session, and sends it as `near=` on every home request. If the user declines or the browser denies, the client omits `near=` and the endpoint falls back cleanly. There is no server-side IP geolocation for MVP.

**CTAs on the home page** (rendered above the two feeds):

- **Signed in** with `open_mics:create` on any of their profiles: a **Register a new open mic** button, and for every open mic the caller can manage, an **Add an event to *〈open-mic-name〉*** button.
- **Signed in** without those permissions: no create CTAs (their `/dashboard` already carries any actions relevant to their role).
- **Anonymous:** a prominent **Sign up** button and a secondary **Sign in** link, with one-line copy explaining what an account unlocks (following organizers, personalized recommendations, claiming past registrations).

---

## 6) Frontend Architecture

Detailed design lives in [5-open-mic-frontend-architecture.md](5-open-mic-frontend-architecture.md). Short summary below.

**Stack:** React 18 + TypeScript + **Vite**, deployed as static assets to the private frontend S3 bucket and served through the required CloudFront distribution.

**Routing & data:** **TanStack Router** (type-safe routes, prefetch on hover) + **TanStack Query** (60 s `staleTime`, stale-while-revalidate). Route-level code splitting is automatic; role-based splits keep organizer, performer, and admin consoles as separate bundles.

**Styling:** Tailwind CSS + Radix/Ark headless primitives.

**Real-time:** A single top-level `useSseSubscription()` hook wires `EventSource` into `queryClient.setQueryData` / `invalidateQueries`. No component polls. Route-scoped live indicators mount their own `EventSource` and close on unmount.

**Skeletons over spinners** on every data-driven surface: the shell renders instantly, each island swaps its skeleton for content as its query resolves.

**Errors & quotas:** the client wrapper parses the shared API error envelope into typed errors (`ValidationError`, `AuthError`, `PermissionError`, `QuotaError`). `X-Quota-<Dimension>-Used/Limit` headers are stored in a small Zustand slice so UI can gate itself without an extra round trip; a `QuotaBanner` warns at 80% and the mutation handler shows the upgrade modal on `QUOTA_EXCEEDED`.

**Performance targets (median device, 4G):** LCP < 2.5 s, TTI < 3.0 s, CLS < 0.05, initial JS bundle ≤ 100 KB gzip, warm route transitions < 100 ms. Enforced with `size-limit` in CI.

**Key Pages:**

*Convention: create/edit flows use distinct routes (`/new`, `/:id/edit`) rather than modals or query flags, so every editor is deep-linkable, back-button-friendly, and independently code-split. Access is permission-gated at the loader; unauthorized users get a 403 boundary, not a redirect.*

*Canonical public URLs use `@handle` vanity form (see [6-open-mic-vanity-urls.md](6-open-mic-vanity-urls.md)). UUID paths listed below still work but 301-redirect to the handle form.*

Public / auth:
- `/` — **Directory home.** Upcoming events and open-mic series with browse and registration actions. Phase 1 does not require personalized feeds, maps, follows, or recommendations.
- `/login` — Sign-in (redirects to Cognito)
- `/register` — Sign-up (delegates to Cognito)
- `/dashboard` — **Signed-in home.** Post-login landing: current profile, owned open-mics and events, registration activity, and organizer actions. Requires authentication; unauthenticated hits redirect to `/`.

Open-mic series:
- `/open-mics/:id` — Series details
- `/open-mics/new` — Create series (requires `open_mics:create`; creates an organizer profile if the current profile isn't one)
- `/open-mics/:id/edit` — Edit series (requires `open_mics:edit` on the owning organizer profile)

Events:
- `/open-mics/:id/events/:eventId` — Event detail, permitted roster, registration controls, and organizer-owned media
- `/open-mics/:id/events/new` — Create event under a series (requires `events:manage`)
- `/open-mics/:id/events/:eventId/edit` — Edit event (requires `events:manage`)
- `/events/:eventId/register` — Public self-registration flow (guest or signed-in); shareable link, reachable via organic browsing, a shared link, an email reminder, a social ad, or a poster QR code — the page and verification behavior are identical regardless of entry point. If `?token=<edit_token>` is present, the server exchanges it for a short-lived HttpOnly edit session, strips the token before rendering, and loads the existing registration for editing without requiring an account. Accepts an optional `?ref=<profile_id>` referral param.
- `/open-mics/:id/register` (and `/@:handle/register`) — Durable "next scheduled event" registration link for posters/QR codes that never need reprinting; forwards to the soonest upcoming event's register page, or shows the open mic's schedule summary if none is currently open.
- `/events/:eventId/collect` — Organizer/assistant walk-in kiosk. Requires `registrations:collect` permission. Loops after each registration to a clean form; toolbar links to view/edit the full roster and to close the event to new registrations.

Profiles:
- `/accounts/:id/profiles` — All profiles for current user
- `/profiles/new` — Create profile (choose type: performer or organizer)
- `/profiles/:id` — Profile details page (performer or organizer)
- `/profiles/:id/edit` — Edit profile (requires `profiles:edit`)

Media:
- `/media/:id` — Organizer-owned media detail view
- `/media/upload` — Organizer media upload (requires an owning organizer profile or event context)
- `/media/:id/edit` — Edit organizer media metadata

Performer media, comments, reviews, reactions, and messaging routes are later-phase features and are not exposed in the Phase 1 navigation or page controls.

Suggestions & messaging:
- `/suggestions` — Suggestion box (list, filter by status/tag)
- `/suggestions/new` — Post a suggestion
- `/suggestions/:id` — Suggestion detail + replies + upvotes
- `/notifications` — Notification center
- `/messages` — Private messages

Settings:
- `/settings` — Account settings (email, password reset via Cognito, notification preferences, quota/plan overview)

**Deployment:**
- Vite build → `dist/`, uploaded to the frontend S3 bucket with immutable hashed filenames.
- `index.html` served with `Cache-Control: no-cache` so revalidation happens on every load.
- CloudFront (Brotli, HTTP/3) is required for the production frontend; it provides HTTPS, SPA fallback, immutable asset caching, and public handle routing.

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
