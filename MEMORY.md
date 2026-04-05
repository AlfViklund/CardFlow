# MEMORY.md - Long-Term Memory

This is curated knowledge. Update it during consolidation, not constantly during sessions.

Use this for durable facts, decisions, constraints, recurring patterns, and evolving identity/preferences.
Update during consolidation, not constantly.

## Current Delivery Status

### Goal
Stay live on the CardFlow board, keep heartbeat health current, and pick up work when assigned.

### Current State
- State: Idle
- Last updated: 2026-04-05 20:14 Asia/Yekaterinburg
- What is happening now: Bootstrap heartbeat completed successfully; no assigned in-progress or review work is available.
- Key constraint/signal: `should_wake=false` / `reason=idle_no_work`
- Why blocked (if any): none
- Next step: Wait for the next heartbeat or a new assignment.

### What Changed Since Last Update
- First bootstrap heartbeat completed for QA Engineer - d11d923b.
- Work snapshot confirmed there is no active task to execute.

### Decisions / Assumptions
- Use the workspace heartbeat cadence as the source of truth for periodic check-ins.
- Stay idle until the board exposes in-progress, inbox, approval, or review work.

### Evidence (short)
- `POST /api/v1/agents/heartbeat` returned agent readback with board_id and identity_profile.
- `GET /api/v1/agents/9367fb8c-bcce-4815-90fd-25084c832e14/work-snapshot` returned `should_wake=false`, `reason=idle_no_work`.

### Request Now
- None

### Success Criteria
- Heartbeat remains healthy and board work is picked up promptly when assigned.

### Stop Condition
- Heartbeat health is up to date and no work is currently assigned.

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