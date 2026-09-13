import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const readJson = async (relativePath: string) =>
  JSON.parse(await readFile(new URL(relativePath, import.meta.url), "utf8"));

test("canonical UI dependencies are pinned in the web app", async () => {
  const pkg = await readJson("../package.json");

  assert.equal(pkg.dependencies["@base-ui/react"], "1.8.0");
  assert.equal(pkg.dependencies["lucide-react"], "1.45.0");
  assert.equal(pkg.devDependencies.tailwindcss, "4.3.3");
  assert.equal(pkg.devDependencies["@tailwindcss/postcss"], "4.3.3");
});

test("shadcn is configured to generate Base UI components with Lucide icons", async () => {
  const config = await readJson("../components.json");

  assert.equal(config.base, "base");
  assert.equal(config.rsc, true);
  assert.equal(config.tsx, true);
  assert.equal(config.iconLibrary, "lucide");
  assert.equal(config.tailwind.config, "");
  assert.equal(config.tailwind.css, "app/globals.css");
  assert.equal(config.tailwind.cssVariables, true);
});
