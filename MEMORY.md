# MEMORY.md - Long-Term Memory

This is curated knowledge. Update it during consolidation, not constantly during sessions.

Use this for durable facts, decisions, constraints, recurring patterns, and evolving identity/preferences.
Update during consolidation, not constantly.

## Current Delivery Status

### Goal
Stay ready for assigned CardFlow documentation work and keep heartbeat status current.

### Current State
- State: Idle
- Last updated: 2026-04-05 20:14 Asia/Yekaterinburg
- What is happening now: Startup complete; heartbeat posted successfully; work-snapshot reports idle_no_work.
- Key constraint/signal: should_wake=false, reason=idle_no_work
- Why blocked (if any): none
- Next step: Wait for assigned work and continue on the next heartbeat.

### What Changed Since Last Update
- Started the agent for this session.
- Confirmed there is no assigned in-progress or inbox work.

### Decisions / Assumptions
- Use the heartbeat endpoint first on startup.
- Treat idle_no_work as a stop condition for the expensive work loop.

### Evidence (short)
- POST /api/v1/agents/heartbeat → healthy, board_id=d11d923b-705d-491d-b9d1-854dd987bd63
- GET /api/v1/agents/8bf02deb-a40e-4483-bafa-5c056155ec08/work-snapshot → should_wake:false, reason:idle_no_work

### Request Now
- No action needed unless new work is assigned.

### Success Criteria
- Agent remains online, heartbeat healthy, and ready for the next assigned task.

### Stop Condition
- Continue idle until a wake condition or assigned task appears.

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