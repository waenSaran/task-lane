# Task Lane Agent Rules

These rules apply to all coding agents working in this repository.

## Work selection and completion

- Use native GitHub issue Relationships as the dependency source of truth. Do not recreate readiness with labels.
- Only start an implementation issue when all native `blockedBy` issues are closed and there is no explicit human hold.
- Keep Plane state separate from Task Lane workflow state.
- Task Lane itself is read-only toward Plane. All Plane writes remain owned by `/plan-feature` and the repository Plane tooling.
- Before closing an issue, satisfy its Acceptance Criteria, run the specified tests plus relevant regression tests, and provide verification evidence.

## Canonical web UI stack

New Task Lane UI work MUST use this stack unless a human explicitly approves an exception:

- Next.js 16 + React 19 + TypeScript
- Tailwind CSS v4 for styling
- shadcn/ui as the component source/distribution layer
- Base UI (`@base-ui/react`) as the default headless primitive library for shadcn components
- Lucide React for icons

Repository configuration for shadcn lives at `apps/web/components.json`.

### Component rules

- Prefer an existing shadcn/ui component before creating a bespoke primitive.
- Add components with the project package runner, for example: `pnpm dlx shadcn@latest add button -c apps/web`.
- Keep generated/customized UI component source under `apps/web/components/ui` and compose application-specific components outside that directory when practical.
- Base UI is the default primitive layer. Do not introduce Radix UI, MUI, Chakra UI, Ant Design, another component system, or CSS-in-JS without explicit human approval.
- When composing Base UI triggers, follow Base UI APIs such as `render`; do not copy Radix-only `asChild` patterns.
- Use Tailwind CSS v4 utilities and semantic CSS variables. Avoid inline style objects for normal layout/styling and avoid adding a second styling system.
- Use Lucide icons rather than mixing icon libraries.
- Preserve accessibility behavior: keyboard navigation, focus visibility, labels, semantic elements, and accessible names are required for interactive UI.
- Prefer composition and variants over duplicating near-identical components.

### UI verification

For UI changes, agents must run the relevant web tests, TypeScript checks, lint, and production build. Interactive behavior must have focused tests where practical. Do not claim a UI change is complete from visual inspection alone.

## Dependency discipline

- Reuse the canonical stack before adding overlapping libraries.
- Pin foundational dependencies deliberately and update them in focused changes.
- Do not add Redis, RabbitMQ, Kubernetes, authentication, or other deferred architecture without an issue and explicit approval.
