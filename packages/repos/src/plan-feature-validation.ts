import { access, readFile } from "node:fs/promises";
import path from "node:path";
import type { RepositoryValidationReport } from "@task-lane/domain";

export const PLAN_FEATURE_SKILL_PATH = ".claude/skills/plan-feature/SKILL.md";

export interface PlanFeatureValidationResult {
  status: "VALID" | "INVALID";
  report: RepositoryValidationReport;
  prerequisites: readonly string[];
}

function isPathLike(value: string): boolean {
  return value.includes("/") || /\.(md|mdx|json|ya?ml|toml|ts|tsx|js|mjs|cjs|sh|py)$/i.test(value);
}

const repositoryRootPrefixes = [".agent/", ".claude/", "apps/", "claude_plan/", "docs/", "packages/", "scripts/", "src/", "tools/"];
const pathToken = /(?:\.agent|\.claude|apps|claude_plan|docs|packages|scripts|src|tools|references|templates)\/[A-Za-z0-9_.:@/-]+/g;

function isRepositoryRootPath(value: string): boolean {
  return repositoryRootPrefixes.some((prefix) => value.startsWith(prefix));
}

function extractPathCandidates(value: string): string[] {
  return [...value.matchAll(pathToken)].map((match) => match[0]);
}

function cleanReference(value: string): string {
  return value
    .trim()
    .replace(/^<|>$/g, "")
    .replace(/[),.;:]+$/g, "")
    .split(/[?#]/, 1)[0]
    ?.trim() ?? "";
}

function addReference(references: Set<string>, raw: string, baseDirectory: string, repositoryRoot: string): void {
  const reference = cleanReference(raw);
  if (!reference || !isPathLike(reference) || reference.includes("://") || reference.startsWith("$")) return;
  const candidate = path.normalize(path.resolve(baseDirectory, reference));
  const relative = path.relative(repositoryRoot, candidate);
  if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) return;
  references.add(relative.split(path.sep).join("/"));
}

export function discoverPlanFeaturePrerequisites(skillContent: string, repositoryRoot: string): string[] {
  const references = new Set<string>();
  const skillDirectory = path.resolve(repositoryRoot, path.dirname(PLAN_FEATURE_SKILL_PATH));
  const markdownLinks = /\[[^\]]*\]\(([^)\s]+)\)/g;
  for (const match of skillContent.matchAll(markdownLinks)) {
    if (match[1]) addReference(references, match[1], isRepositoryRootPath(match[1]) ? repositoryRoot : skillDirectory, repositoryRoot);
  }
  const inlineCode = /`([^`]+)`/g;
  for (const match of skillContent.matchAll(inlineCode)) {
    for (const value of extractPathCandidates(match[1] ?? "")) {
      addReference(references, value, isRepositoryRootPath(value) ? repositoryRoot : skillDirectory, repositoryRoot);
    }
  }
  for (const value of extractPathCandidates(skillContent)) {
    addReference(references, value, isRepositoryRootPath(value) ? repositoryRoot : skillDirectory, repositoryRoot);
  }
  references.delete(PLAN_FEATURE_SKILL_PATH);
  return [...references].sort();
}

async function exists(repositoryRoot: string, relativePath: string): Promise<boolean> {
  try {
    await access(path.resolve(repositoryRoot, relativePath));
    return true;
  } catch {
    return false;
  }
}

export async function validatePlanFeatureRepository(
  repositoryRoot: string,
  now: () => string = () => new Date().toISOString(),
): Promise<PlanFeatureValidationResult> {
  const errors: string[] = [];
  let skillContent = "";
  if (!(await exists(repositoryRoot, PLAN_FEATURE_SKILL_PATH))) {
    errors.push(`Missing required skill: ${PLAN_FEATURE_SKILL_PATH}`);
  } else {
    try {
      skillContent = await readFile(path.resolve(repositoryRoot, PLAN_FEATURE_SKILL_PATH), "utf8");
    } catch {
      errors.push(`Unable to read required skill: ${PLAN_FEATURE_SKILL_PATH}`);
    }
  }

  const prerequisites = skillContent ? discoverPlanFeaturePrerequisites(skillContent, repositoryRoot) : [];
  for (const prerequisite of prerequisites) {
    if (!(await exists(repositoryRoot, prerequisite))) {
      errors.push(`Missing plan-feature prerequisite: ${prerequisite}`);
    }
  }

  return {
    status: errors.length === 0 ? "VALID" : "INVALID",
    report: { checkedAt: now(), errors, warnings: [] },
    prerequisites,
  };
}
