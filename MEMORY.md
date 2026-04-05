# MEMORY.md - Long-Term Memory

This is curated knowledge. Update it during consolidation, not constantly during sessions.

Use this for durable facts, decisions, constraints, recurring patterns, and evolving identity/preferences.
Update during consolidation, not constantly.

- Preferences / working style:
- What I learned about the human:
- What changed recently:

## Current Delivery Status

### Goal
Stand up the CardFlow platform foundation for task `115b60aa-b367-45ad-9f19-77778dbc1e84`.

### Current State
- State: Working
- Last updated: 2026-04-05 23:01 Asia/Yekaterinburg
- What is happening now: The platform foundation is scaffolded and smoke-tested; an evidence comment was posted back to the task.
- Key constraint/signal: Source of truth is the approved planner package/dossier; task must cover Next.js web shell, API, worker, Postgres, Redis/BullMQ, and S3-compatible storage.
- Why blocked (if any): the task is still in_progress until the board accepts a successful run/test record.
- Next step: If needed, create the official successful run record; otherwise keep monitoring or move on once the board accepts the evidence.

### What Changed Since Last Update
- Confirmed the active board task and acceptance criteria from the board snapshot.
- Marked the task `in_progress`.

### Decisions / Assumptions
- Build a small TypeScript monorepo with separate web/API/worker packages.
- Use SQL migrations plus a tiny runner instead of introducing a heavier ORM on day one.
- Use MinIO as the S3-compatible local dev target.

### Evidence (short)
- `GET /api/v1/boards/d11d923b-705d-491d-b9d1-854dd987bd63/snapshot`
- `PATCH /api/v1/boards/d11d923b-705d-491d-b9d1-854dd987bd63/tasks/115b60aa-b367-45ad-9f19-77778dbc1e84` → `status: in_progress`

### Request Now
- none

### Success Criteria
- Local dev shell starts web, API, worker, Postgres, Redis, and MinIO together.
- Core DB tables and traceability records exist.
- Queue and storage flows can be smoke-tested end-to-end.

### Stop Condition
- Foundation scaffold is in place, verified, and commented back on the task.


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

Last consolidated: [YYYY-MM-DD]