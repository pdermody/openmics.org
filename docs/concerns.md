# Open Mic Documentation Review: Concerns and Gaps

## Summary

This document captures the main concerns identified during a review of the Open Mic planning documents in this folder. The project concept is promising, but the current documentation set is not yet cohesive enough to serve as a complete implementation specification without additional tightening.

The strongest areas are the product intent, event use cases, and general direction. The main issues are scope drift, inconsistency across documents, under-specified permissions and consent logic, and gaps in security/privacy design.

---

## Overall Assessment

### What is strong
- Clear product vision for organizer-first workflows
- Strong emphasis on registration conversion as the primary success metric
- Good recognition that non-technical users need sensible defaults
- Thoughtful concept around profile handles and vanity URLs
- Clear separation of roles for organizer, performer, and public viewer
- Service architecture is generally structured well enough for future design work

### What is weak
- The documentation is not fully aligned across product, architecture, URL strategy, and API contract
- Several MVP decisions conflict with other sections of the same documents
- Security and privacy requirements are not yet fully specified
- Consent, moderation, and soft-delete flows are described conceptually but not operationally
- The API contract does not fully reflect the lifecycle described in the requirements and vanity-URL documents

---

## 1) Major Inconsistencies and Contradictions

### 1.1 MVP scope is inconsistent

The project documents describe different MVP boundaries.

Examples:
- [2-open-mic-research-results.md](2-open-mic-research-results.md) says the delivery order is organizer-first, then performer, then public/community. It also states that organizer review moderation is part of MVP.
- [3-open-mic-requirements.md](3-open-mic-requirements.md) includes a “MVP vs Post-MVP” matrix where reviews are marked as post-MVP, while also describing review submission and review moderation in the main requirements section.

This is a direct contradiction: the same product area is described as both in scope and out of scope for MVP.

### 1.2 Architecture assumptions conflict with the product’s eventual scale story

The product documents describe a long-term ambition of hundreds of open-mics and overlapping events. However, [4-open-mic-technical-architecture.md](4-open-mic-technical-architecture.md) says the MVP has:
- ~1,000 users in year 1
- ~10 open-mics
- a single EC2 instance for MVP

This can be valid for a startup prototype, but the docs do not reconcile the early MVP constraints with the long-term platform target. The product needs a clearer statement of:
- MVP capacity target
- near-term growth target
- long-term scale target
- when the architecture is required to change

### 1.3 Vanity URL design is not fully represented in the technical architecture and API contract

[6-open-mic-vanity-urls.md](6-open-mic-vanity-urls.md) introduces a comprehensive handle system with:
- a global handle namespace
- reserved handles
- retires/redirects
- tombstoning
- handle validation rules
- rename policy
- database design with a Handles table

But [4-open-mic-technical-architecture.md](4-open-mic-technical-architecture.md) does not include this table in its schema overview, and [openapi.yaml](../openapi.yaml) only partially exposes the handle-check endpoint. The resulting design is strong, but it is not consistently reflected in the rest of the documentation.

### 1.4 Guest registration lifecycle is described but not fully formalized

The guest registration flow described in [3-open-mic-requirements.md](3-open-mic-requirements.md) includes:
- guest registration with pending state until email confirmation
- an exemption for walk-in kiosk registrations
- user-initiated claiming of guest records by verified account
- public event listing with guest-attributed names

This is a reasonable workflow, but the lifecycle is under-defined. Missing details include:
- duplicate registration handling
- claim conflicts and precedence rules
- how organizer moderation affects guest data
- what happens if a guest later creates an account and claims a row after a different account already claimed it
- what happens if a performer changes name, identity, or email later

---

## 2) Completeness Gaps

These are the main missing or under-defined areas.

### 2.1 TBD items remain throughout the docs

The documents still contain several unresolved items, including:
- exact input patterns for performer detail collection
- exact UI behavior for consent display and consent changes
- notification preferences and delivery rules
- retention periods for soft-deleted media
- final moderation workflow for event and open-mic content
- exact rules for multiple identities and profile links

These are not minor details; they are central to trust, permissions, and user experience.

### 2.2 Operational behavior is missing

The planning docs do not yet define operational rules such as:
- handling duplicate registrations
- recovery after failed media uploads
- small-scale performance limits
- race conditions in event registration and claim operations
- event closure behavior and lock rules
- reviewer moderation workflows and public visibility while under moderation

### 2.3 Security and privacy details are under-specified

The docs do not yet fully define:
- content sanitization rules for profile text, comments, reviews, and media captions
- XSS prevention and content validation
- upload validation and malware scanning for photos/video metadata
- rate limits for registration, messaging, review posting, and media interactions
- abuse protection strategies
- audit logs for consent and moderation decisions

### 2.4 Data retention and deletion obligations are not fully stated

The media soft-delete and recycle-bin concept is strong, but there is no clear statement for:
- maximum retention period
- when permanent deletion occurs
- what happens to public references after deletion
- whether soft-deleted profile content is still indexed or visible in search results
- whether deleted records are still accessible to administrators for audit purposes

---

## 3) Security and Privacy Concerns

### 3.1 Consent is central but not fully audited

The product treats photo and video publishing consent as default-yes for guest and registered performers, which may be acceptable for community engagement, but the docs do not specify:
- who can view consent status
- how consent is captured and stored
- how consent can be revoked or changed
- whether consent changes are versioned and auditable
- whether consent is tied to event-specific media vs global profile media

A product dealing with public identity and media needs a clear audit trail for user decisions.

### 3.2 Access control is complex but under-defined in detail

The permissions matrix is useful, but it does not fully define:
- how role permissions are checked at the API layer
- the difference between organizer moderation authority and content ownership
- if same-person users with multiple profiles can access each other’s data
- how organizers can edit data on behalf of performers
- how profile-level permissions interact with event-level registrations and media ownership

This becomes a risk area as soon as more user roles and profile contexts are added.

### 3.3 Identity and impersonation risk is not fully addressed

The vanity URL strategy is thoughtful and useful, but impersonation and handle abuse are still important risks:
- handle collisions and reserved names must be enforced server-side
- rename races need locking and validation
- reserved namespaces must be manageable without deploying code
- display names and handles should not be confused in public UI

The docs reference this risk, but they should also include explicit security controls and a threat model.

### 3.4 Media pipeline needs stronger controls

The architecture proposes S3 media storage and signed URLs, which is a good baseline, but the documents do not yet define:
- upload policy and MIME validation
- file-size limits
- image/video transformation and security sandboxing
- virus-scanning strategy for uploaded files
- expiration and rotation policy for presigned URLs
- access scoping for organizer vs performer media

These are operational security requirements for any product storing user media.

### 3.5 Abuse moderation is described conceptually but not in a usable policy

The product discusses reviews, comments, reactions, and messages, but it lacks a firm abuse-moderation model. Missing items include:
- moderation roles and escalation paths
- reporting flows
- acceptable-use rules
- data retention for removed comments/reviews
- timeline for moderation actions and notifications
- privacy restrictions for private messages

Without a clear moderation model, trust and safety are at risk.

---

## 4) Vagueness and Risky Ambiguities

The following statements are directionally good but too vague for implementation without further specification:

- “multiple ways for performers to provide details”
- “performers can maintain multiple identities”
- “organizers can moderate and respond to reviews”
- “default consent is yes”
- “public pages respect organizer moderation”
- “registered users can post comments on all photos and videos”
- “organizers have full edit authority”

These ideas need concrete rules, especially in a system that must support:
- multiple profiles per user
- multiple open-mics per organizer
- cross-entity permissions
- user-generated content visibility
- soft-delete and recycle-bin behavior

The main risk is not that the ideas are wrong; it is that they are not specific enough to implement consistently.

---

## 5) Areas of Good Design Worth Preserving

Despite the concerns, several parts of the documentation are well reasoned and should be kept:

- organizer-first MVP sequencing
- focus on registrations-per-event as the product KPI
- non-technical UX defaults
- concise separation of organizer and performer responsibilities
- strong concept of a public, handle-based URL system
- media ownership and organizer/performer separation in the requirements
- use of soft-delete and recycle-bin concepts for content recovery

These ideas are valuable and should be retained, but they require more precise specification and some alignment with the rest of the docs.

---

## 6) Specific Recommendations

### Priority 1: Align the source of truth
- Decide which document is the canonical product spec
- Remove contradictions between MVP and post-MVP scope
- Ensure the technical architecture and API contract match the requirements document

### Priority 2: Define the lifecycle states clearly
- registration states
- guest claim states
- media visibility states
- consent states
- moderation states
- soft-delete/recovery states

### Priority 3: Add a security/privacy section
- threat model
- abuse protections
- content moderation policy
- retention policy
- audit logging for consent and moderator actions

### Priority 4: Tighten the API and DB contract
- align handle model with actual endpoint coverage
- define review/comment/reaction state transitions
- formalize permission checks in API design

### Priority 5: Clarify roadmap and scale assumptions
- MVP capacity target
- near-term growth target
- long-term architecture change points

---

## Final Verdict

The project concept is promising and the strategic direction is sound, but the current documentation set is not yet complete enough to act as a reliable implementation contract. The most urgent issues are:
- contradictory MVP decisions
- under-specified permissions and consent states
- incomplete security/privacy treatment
- inconsistent architecture/API alignment

These should be addressed before implementation begins, otherwise the engineering team will be forced to resolve critical product decisions in code rather than in specification.
