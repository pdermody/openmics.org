# Architecture Overview

**Related:** [../4-open-mic-technical-architecture.md](../4-open-mic-technical-architecture.md)

---

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
