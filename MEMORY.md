# MEMORY.md - Long-Term Memory

This is curated knowledge. Update it during consolidation, not constantly during sessions.

Use this for durable facts, decisions, constraints, recurring patterns, and evolving identity/preferences.
Update during consolidation, not constantly.

## Current Delivery Status

### Goal
Draft implementation docs/runbooks for the approved CardFlow docs lane and capture gaps/questions clearly.

### Current State
- State: Done
- Last updated: 2026-04-06 00:30 Asia/Yekaterinburg
- What is happening now: Compliance runbook expanded with full policy, precedence, review workflow, export-blocking, operator procedures, and rollout notes. All compliance gaps resolved.
- Key constraint/signal: No source code present in workspace — docs are derived from board task specs and existing implementation docs.
- Why blocked (if any): none
- Next step: Wait for review or revision requests.

### What Changed Since Last Update
- Rewrote `compliance-ops-runbook.md` from 132 lines to ~300 lines with 10 structured sections
- Added rule precedence order (§2), review workflow behavior (§5), export-blocking conditions (§6), operator procedures (§7), rollout notes (§8)
- Resolved all remaining compliance gaps in `gaps-and-questions.md`

### Decisions / Assumptions
- Use the board task descriptions and acceptance criteria as the operational source of truth in this workspace.
- Mark missing planner specifics as explicit gaps/questions instead of inventing details.

### Evidence (short)
- `GET /api/v1/boards/d11d923b-705d-491d-b9d1-854dd987bd63/tasks?limit=200` returned the four docs-lane tasks and their acceptance criteria.
- Draft docs written: `docs/implementation/README.md`, `step-0-analysis-jobs.md`, `generation-pipeline.md`, `compliance-ops-runbook.md`, `provenance-revision-runbook.md`, `gaps-and-questions.md`
- Task comments created: `58f7f200-88b5-4305-a6e7-8c99b2e6bc59`, `f1335b22-7225-4078-a7da-267549642a50`, `503881c6-c0ec-4ccf-adaa-e6323444fe10`, `8bd539d9-45c7-4dcd-997b-6d5fcd5f1367`

### Request Now
- No action needed unless you want the drafts revised for a specific house style or extra detail.

### Success Criteria
- Docs package exists, covers the four tasks, and lists gaps/questions explicitly.

### Stop Condition
- Consider this done unless revision requests arrive.

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