# CardFlow platform foundation

This repo stands up the base CardFlow development stack:

- Next.js frontend shell in `apps/web`
- Fastify monolith API in `apps/api`
- BullMQ worker in `apps/worker`
- SQL migrations and repository helpers in `packages/db`
- S3-compatible storage helpers in `packages/storage`
- Shared request contracts in `packages/core`

## Local development

1. Copy `.env.example` to `.env` if you want to override defaults.
2. Install dependencies:

   ```bash
   npm install
   ```

3. Start the full stack:

   ```bash
   npm run dev
   ```

The dev shell starts:

- Postgres on `localhost:15432`
- Redis on `localhost:16379`
- MinIO on `localhost:19000` / console on `localhost:19001`
- API on `localhost:3400`
- Web app on `localhost:3300`
- Worker in the background

## Useful commands

- `npm run db:migrate` — apply SQL migrations
- `npm run check` — typecheck all workspaces
- `npm run dev` — boot infra, migrate, then start API + worker + web

## Foundation primitives

The initial schema includes:

- `projects`
- `assets`
- `jobs`
- `revisions`
- `trace_events`

The API exposes:

- `GET /healthz`
- `GET /readyz`
- `POST /v1/projects`
- `POST /v1/jobs`
- `POST /v1/assets`
- `GET /v1/assets/:id/download`
