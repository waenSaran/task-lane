# Task Lane

Task Lane is a localhost-only orchestration UI for the Plane + `/plan-feature` workflow.

The current foundation provides the TypeScript monorepo, Next.js web app, Node worker, PostgreSQL runtime, Docker Compose configuration, service health probes, and the canonical web UI foundation.

## Prerequisites

- Docker Desktop for macOS, configured to start at login
- Node.js 24 LTS for host-side development
- pnpm 12.4.1

## Start the local stack

```bash
mkdir -p ~/.task-lane/{repos,plans,logs}
cp .env.example .env
docker compose up -d --build
```

Open <http://127.0.0.1:3000>.

```bash
curl --fail http://127.0.0.1:3000/api/health
docker compose ps
docker compose logs -f web worker postgres
```

Stop services with `docker compose down`.

PostgreSQL data is stored in the named `postgres_data` volume. Planning runtime data is stored under `~/.task-lane/{repos,plans,logs}` so it survives container recreation.

## Host-side development

```bash
corepack enable
corepack prepare pnpm@12.4.1 --activate
pnpm install
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

## Web UI foundation

The canonical Task Lane UI stack is:

- Next.js 16 + React 19 + TypeScript
- Tailwind CSS v4
- shadcn/ui
- Base UI primitives (`@base-ui/react`)
- Lucide React icons

shadcn configuration lives at `apps/web/components.json`. Add components from the repository root with the pnpm runner, for example:

```bash
pnpm dlx shadcn@latest add button -c apps/web
```

Coding-agent rules, including the requirement to reuse this UI stack instead of adding another component/styling system, live in `AGENTS.md`.

## Architecture boundary

- `apps/web`: Next.js dashboard/API process
- `apps/worker`: separate Node.js worker process
- `packages/*`: shared domain/integration boundaries
- `postgres`: state store and future DB-backed queue

Task Lane itself will remain read-only toward Plane; Plane writes belong to `/plan-feature` in later milestones.
