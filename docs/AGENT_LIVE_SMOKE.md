# Agent CLI live smoke checks

These checks are opt-in and require the developer's own authenticated CLI configuration. They must not run in CI and must use a disposable repository. They do not write to Plane unless a real `/plan-feature` instruction is intentionally supplied.

Pinned worker image versions:

- Codex CLI `0.154.0`, installed with `npm install --global @openai/codex@0.154.0`.
- Grok CLI `1.0.30`, installed with `https://x.ai/cli/install.sh | bash -s -- 1.0.30`.

Update both pins intentionally after checking the official CLI release/install documentation, then verify the image with:

```sh
docker compose build worker
docker compose run --rm --entrypoint codex worker --version
docker compose run --rm --entrypoint grok worker --version
```

Runtime boundaries verified for these pins:

- Codex discovers repository skills from `.agents/skills`; it does not natively discover the repository's canonical `.claude/skills/plan-feature/SKILL.md`. The adapter therefore creates a run-scoped `$HOME/.agents/skills/plan-feature` directory symlink outside the checkout, points it at that canonical directory, and translates the internal Codex prompt to `$plan-feature <Plane UC>` for explicit skill invocation. The public adapter input remains `/plan-feature <Plane UC>`.
- Grok `1.0.30` reads Claude-compatible `.claude/skills` directly, so it does not need the Codex bridge.
- Both adapters use native `workspace-write` mode so `/plan-feature` can run child commands, create draft/handoff files, and reach Plane. The worker keeps repository management writable at `/data/repos` and mounts the same storage as `/data/agent-repos:ro`; adapters translate the managed checkout path to the agent-facing view. Session, scratch, logs, and handoff paths remain writable outside the source checkout. Grok also uses `--always-approve` only to avoid an unattended prompt.
- The bridge and runtime are created under the caller-provided artifact root. The source checkout is never changed. Codex auth/config are referenced through symlinks to the read-only runtime inputs; they are not copied into the runtime volume.

After building the agents package, run the capability checks from a disposable checkout:

```sh
pnpm --filter @task-lane/agents build
node --input-type=module <<'NODE'
import { CodexAdapter, GrokAdapter } from './packages/agents/dist/index.js';

for (const [name, adapter] of [['Codex', new CodexAdapter()], ['Grok', new GrokAdapter()]]) {
  console.log(name, await adapter.doctor());
}
NODE
```

For a harmless direct execution, use an empty disposable Git repository and an instruction that explicitly forbids edits:

```sh
tmp_dir="$(mktemp -d)"
git -C "$tmp_dir" init
export TASK_LANE_SMOKE_DIR="$tmp_dir"
node --input-type=module <<'NODE'
import { CodexAdapter } from './packages/agents/dist/index.js';
const result = await new CodexAdapter().start({
  runId: 'live-codex-smoke',
  cwd: process.env.TASK_LANE_SMOKE_DIR,
  instruction: 'Print the repository path and make no file changes.',
  artifactRoot: `${process.env.TASK_LANE_SMOKE_DIR}/artifacts`,
});
console.log(result);
NODE
rm -rf "$tmp_dir"
```

Replace `CodexAdapter` with `GrokAdapter` for the Grok check. Keep the adapter's artifact directory outside any repository that matters. Command construction for `/plan-feature <Plane UC>` is covered by the fixture tests; a real `/plan-feature` run is a separate deliberate smoke test and may write through the existing Plane tooling.

To verify the Codex bridge explicitly, add a disposable repository skill at `.claude/skills/plan-feature/SKILL.md` whose description and body produce a unique harmless marker, then run the adapter with `instruction: '/plan-feature DOAE-1234'`. The result's stdout artifact must contain that marker and a session id. The adapter will pass `$plan-feature DOAE-1234` to Codex while keeping the canonical skill in the disposable checkout and the bridge outside it.
