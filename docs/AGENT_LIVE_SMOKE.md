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
