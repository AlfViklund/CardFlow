# Plan: 1e153893 — Observability Query API for Usage/Cost Dashboards

## Goal
Build the observability query layer connecting the usage/cost dashboards to billing, events, and cache data sources.

## Implementation
- **Core types** — `UsageResponse`, `CostResponse`, `EventTraceResponse`
- **Date utilities** — `generateDateLabels()` for 7d/30d/90d
- **Format helpers** — `formatCents()`, `calculateBudgetPct()`, `forecastMonthly()`
- **Alert generation** — budget warnings (70%+, 90%) and spend forecasts

## Files
- CREATE: `packages/core/src/observability.ts`
- CREATE: `packages/core/src/observability.test.ts`
- MODIFY: `packages/core/src/index.ts` — exports

## Tests
- Date ranges: 7d=7, 30d=30, 90d=90 labels
- Format: cents formatting (<$1 and >=$1)
- Budget: percentage calculation, capped at 100%
- Forecast: monthly projection
- Alerts: healthy (none), 70%+ (warning), 90%+ (critical), forecast overage
