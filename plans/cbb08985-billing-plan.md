# Plan: cbb08985 — Credits Ledger & Subscription Billing

## Goal
Append-only credits ledger + subscription state machine + credit consumption API. Billing checks before job enqueue. No payment provider.

## What to Build

### 1. SQL Migration `packages/db/migrations/0009_billing.sql`
- `subscriptions` table — plan, status, current_period_start/end, created_at, updated_at
- `credits_ledger` table — append-only, type (purchase|consumption|grant|refund), amount (+/-), reference columns, created_at
- `projects` FK -> `subscriptions` and `credits_ledger`

### 2. Core Types `packages/core/src/billing.ts`
- `SubscriptionPlan` enum (free, basic, pro, enterprise)
- `SubscriptionStatus` enum (active, past_due, cancelled, expired)
- `CreditTransactionType` enum (purchase, consumption, grant, refund)
- Subscription state machine logic
- Per-plan limits (credits_per_month, max_jobs, max_res)

### 3. DB Layer `packages/db/src/billing.ts`
- `getSubscription(pool, subscriptionId)`
- `createSubscription(pool, ...)`
- `upgradeSubscription(pool, subscriptionId, newPlan)`
- `recordCreditTransaction(pool, ...)` — append-only
- `getCreditBalance(pool, subscriptionId)` — sum of ledger
- `checkCreditBalance(pool, subscriptionId, required)` — before job enqueue

### 4. API Endpoints `apps/api/src/server.ts`
- `GET /v1/billing/:projectId` — subscription + balance
- `GET /v1/billing/:projectId/ledger` — ledger entries
- `POST /v1/billing/:projectId/subscription` — create
- `POST /v1/billing/:projectId/upgrade` — upgrade plan
- `POST /v1/billing/:projectId/grant` — grant credits (admin)

### 5. Tests `packages/core/src/billing.test.ts`
