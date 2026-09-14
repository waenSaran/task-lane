# Task Lane Agent Rules

These rules apply to all coding agents working in this repository.

## Canonical project references

Read these before changing the corresponding boundary:

- `docs/ARCHITECTURE.md` — system responsibilities, data ownership, Plane write boundary, repository/agent model, persistence, and architecture guardrails.
- `docs/PLAN_FEATURE_HANDOFF.md` — deterministic machine contract between Task Lane and `/plan-feature`, including statuses, hashes, approval safety, and validation rules.

Do not duplicate these contracts in new agent-specific rule files. If a tool requires its own instruction file, point it back to this `AGENTS.md` and the relevant canonical document.

## Work selection and completion

- Use native GitHub issue Relationships as the dependency source of truth when available. Do not recreate readiness with labels.
- Only start an implementation issue when all known blockers are closed and there is no explicit human hold.
- Make meaningful implementation slices visible as issues/linked child issues instead of hiding a long sequence of internal subtasks.
- Keep Plane state separate from Task Lane workflow state.
- Task Lane itself is read-only toward Plane. All Plane writes remain owned by `/plan-feature` and the repository Plane tooling.
- Before closing an issue, satisfy its Acceptance Criteria, run the specified tests plus relevant regression tests, and provide verification evidence.
- Prefer fast targeted local/agent checks while implementing. Do not intentionally push RED commits merely to use the full GitHub Actions pipeline as a test runner when a local checkout is available.

## Canonical web UI stack

New Task Lane UI work MUST use this stack unless a human explicitly approves an exception:

- SvelteKit + Svelte 5 + TypeScript
- Tailwind CSS v4 through `@tailwindcss/vite`
- shadcn-svelte as the component source/distribution convention
- Bits UI as the default headless primitive layer
- `@lucide/svelte` for icons
- SvelteKit `adapter-node` for the local Node web runtime

Repository configuration for shadcn-svelte lives at `apps/web/components.json`.

### Component rules

- Prefer an existing shadcn-svelte component before creating a bespoke primitive.
- Add components from `apps/web`, for example: `pnpm dlx shadcn-svelte@latest add button`.
- Keep generated/customized UI source under `apps/web/src/lib/components/ui` and compose application-specific components outside that directory when practical.
- Bits UI is the default primitive layer. Do not introduce React, Next.js, Base UI React, Radix UI, MUI, Chakra UI, Ant Design, another component system, or CSS-in-JS without explicit human approval.
- Use Svelte 5 conventions (`$props`, `$state`, derived state where appropriate) instead of React hook patterns.
- Keep server-only database/integration work in SvelteKit server routes/modules. Do not move shared business logic out of the existing workspace packages into UI components.
- Use Tailwind CSS v4 utilities and semantic CSS variables. Avoid inline style attributes for normal layout/styling and avoid adding a second styling system.
- Use `@lucide/svelte` rather than mixing icon libraries.
- Preserve accessibility behavior: keyboard navigation, focus visibility, labels, semantic elements, and accessible names are required for interactive UI.
- Prefer small, composable `.svelte` components and explicit props over large page components with hidden cross-component state.

### UI verification

For UI changes, agents must run the relevant web tests, Svelte/TypeScript checks, the repository lint/check command, and production build. Interactive behavior must have focused tests where practical. Do not claim a UI change is complete from visual inspection alone.

## Dependency discipline

- Reuse the canonical stack before adding overlapping libraries.
- Pin foundational dependencies deliberately and update them in focused changes.
- Do not add Redis, RabbitMQ, Kubernetes, authentication, or other deferred architecture without an issue and explicit approval.
