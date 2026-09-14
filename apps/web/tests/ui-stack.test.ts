import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readJson = async (relativePath: string) =>
  JSON.parse(await readFile(new URL(relativePath, import.meta.url), "utf8"));

test("canonical Svelte UI dependencies are pinned in the web app", async () => {
  const pkg = await readJson("../package.json");

  assert.equal(pkg.dependencies["bits-ui"], "2.19.2");
  assert.equal(pkg.dependencies["@lucide/svelte"], "1.45.0");
  assert.equal(pkg.dependencies.clsx, "2.1.1");
  assert.equal(pkg.dependencies["tailwind-merge"], "3.6.0");
  assert.equal(pkg.devDependencies.tailwindcss, "4.3.3");
  assert.equal(pkg.devDependencies["@tailwindcss/vite"], "4.3.3");

  assert.equal(pkg.dependencies.react, undefined);
  assert.equal(pkg.dependencies["react-dom"], undefined);
  assert.equal(pkg.dependencies["@base-ui/react"], undefined);
  assert.equal(pkg.dependencies["lucide-react"], undefined);
});

test("shadcn-svelte is configured for Svelte 5 and Tailwind v4", async () => {
  const config = await readJson("../components.json");

  assert.equal(config.$schema, "https://shadcn-svelte.com/schema.json");
  assert.equal(config.style, "new-york");
  assert.equal(config.typescript, true);
  assert.equal(config.tailwind.css, "src/app.css");
  assert.equal(config.tailwind.baseColor, "neutral");
  assert.equal(config.aliases.lib, "$lib");
  assert.equal(config.aliases.ui, "$lib/components/ui");
  assert.equal(config.aliases.utils, "$lib/utils");
  assert.equal(config.registry, "https://shadcn-svelte.com/registry");
});
