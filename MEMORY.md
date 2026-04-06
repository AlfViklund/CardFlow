# MEMORY.md - Long-Term Memory

This is curated knowledge. Update it during consolidation, not constantly during sessions.

Use this for durable facts, decisions, constraints, recurring patterns, and evolving identity/preferences.
Update during consolidation, not constantly.

- Preferences / working style:
- What I learned about the human:
- What changed recently:

## Current Delivery Status

### Goal
Implement CardFlow platform incrementally — completing assigned epic tasks from inbox.

### Current State
- State: Idle (all 9 dev tasks done)
- Last updated: 2026-04-06 09:07 YEK
- What is happening now: c366d801 closed by @lead. All developer work on the board complete.
- Key constraint/signal: No dev-scoped tasks available — only QA (5 in_progress) and docs (4, blocked on QA) remain
- Why blocked (if any): no dev work in inbox
- Next step: Await QA findings, bug reports, or scope expansion from Arslek

### What Changed Since Last Update
- c366d801 closed by @lead. Board reports all 9 dev tasks **done**.

### Decisions / Assumptions
- Build a small TypeScript monorepo with separate web/API/worker packages.
- Use SQL migrations plus a tiny runner instead of introducing a heavier ORM on day one.
- Use MinIO as the S3-compatible local dev target.
- Transient errors (ECONNREFUSED, ETIMEDOUT, timeout, deadlock, rate limit, 503, 504) get exponential backoff retry; permanent failures go to dead-letter.
- Startup recovery scans for jobs stuck in 'processing' beyond configurable threshold and re-enqueues them.
- All 9 dev tasks are now done. Remaining work: 5 QA tasks (in_progress), 4 docs tasks (blocked on QA).

### Evidence (short)
- `npm run check` — all 6 workspaces pass with zero errors
- Migration 0008: `dead_letter_reason`, `last_retry_at`, `stall_detected_at` columns + indexes
- Worker: transient/permanent classification, 1-16min backoff, dead-letter, stalled-job recovery

### Request Now
- none

### Success Criteria
- All 9 dev task acceptance criteria met ✅
- BullMQ worker lifecycle: retry, dead-letter, recovery all implemented ✅

### Stop Condition
- All dev tasks complete. Awaiting QA findings or new scope.


## Board Context (read-only unless board goal changes)

- Board: CardFlow
- Board type: goal
- Objective: CardFlow AI — web SaaS для селлеров Ozon и Wildberries, который превращает создание карточек товара в управляемый workflow: бриф → план текстов → сцены → выбор дизайн-концепции → финальная серия карточек → точечные правки → экспорт. Ключевая ценность — не генерация одной картинки, а создание консистентной серии карточек под правила маркетплейсов.
- Success metrics: {"target": "launch in two weeks"}
- Target date: 


## Constraints / Assumptions

- [Add constraints that affect decisions and task execution]

## Decisions (with rationale)

- [Decision] - [Why]

## Known Risks / Open Questions

- [Risk or question] - [Mitigation or next step]

## Useful References

- [Commands, paths, URLs (without secrets)]

---

Last consolidated: 2026-04-06
