import { execFile } from "node:child_process";
import { mkdir, mkdtemp, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import type { GithubSshRepository } from "./github-ssh-url.js";

const execFileAsync = promisify(execFile);

export type GitFailureCode = "GIT_NOT_INSTALLED" | "GIT_COMMAND_FAILED";

export class GitCommandError extends Error {
  public readonly code: GitFailureCode;

  constructor(code: GitFailureCode, message: string) {
    super(message);
    this.code = code;
    this.name = "GitCommandError";
  }
}

export interface GitCommandResult {
  stdout: string;
  stderr: string;
}

function sanitizeGitOutput(value: string): string {
  return value
    .replace(/-----BEGIN [\s\S]*?-----END [^-]+-----/gi, "[redacted-key]")
    .replace(/(?:git@github\.com:|ssh:\/\/git@github\.com\/)[^\s'"`]+/gi, "[redacted-repository]")
    .replace(/(password|passphrase|token|secret|identityfile|private[_-]?key)\s*[=:]\s*[^\s]+/gi, "$1=[redacted]")
    .replace(/\s+/g, " ")
    .trim();
}

export function sanitizedGitMessage(value: unknown, fallback = "Git operation failed"): string {
  const message = value instanceof Error ? value.message : String(value ?? "");
  const sanitized = sanitizeGitOutput(message);
  return sanitized || fallback;
}

export async function runGit(
  args: readonly string[],
  cwd: string,
  env: NodeJS.ProcessEnv = {},
): Promise<GitCommandResult> {
  try {
    const result = await execFileAsync("git", [...args], {
      cwd,
      env: { ...process.env, ...env, GIT_TERMINAL_PROMPT: "0" },
      maxBuffer: 1024 * 1024,
    });
    return {
      stdout: result.stdout.toString(),
      stderr: result.stderr.toString(),
    };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code === "ENOENT" ? "GIT_NOT_INSTALLED" : "GIT_COMMAND_FAILED";
    const output = sanitizeGitOutput(`${(error as { stdout?: string }).stdout ?? ""} ${(error as { stderr?: string }).stderr ?? ""}`);
    throw new GitCommandError(code, output ? `Git operation failed: ${output}` : "Git operation failed");
  }
}

async function pathExists(target: string): Promise<boolean> {
  try {
    await stat(target);
    return true;
  } catch {
    return false;
  }
}

export interface SyncedRepository {
  mainSha: string;
  cloned: boolean;
}

export async function withRepositoryTreeAtRef<T>(
  localPath: string,
  ref: string,
  callback: (repositoryRoot: string) => Promise<T>,
): Promise<T> {
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "task-lane-repository-tree-"));
  const archivePath = path.join(temporaryRoot, "repository.tar");
  const repositoryRoot = path.join(temporaryRoot, "tree");
  await mkdir(repositoryRoot);
  try {
    await runGit(["-C", localPath, "archive", "--format=tar", ref, "-o", archivePath], localPath);
    await execFileAsync("tar", ["-xf", archivePath, "-C", repositoryRoot]);
    return await callback(repositoryRoot);
  } finally {
    await rm(temporaryRoot, { recursive: true, force: true });
  }
}

async function ensureRemote(localPath: string, remoteUrl: string): Promise<void> {
  try {
    await runGit(["-C", localPath, "remote", "get-url", "origin"], localPath);
    await runGit(["-C", localPath, "remote", "set-url", "origin", remoteUrl], localPath);
  } catch (error) {
    if (error instanceof GitCommandError && error.code === "GIT_COMMAND_FAILED") {
      await runGit(["-C", localPath, "remote", "add", "origin", remoteUrl], localPath);
      return;
    }
    throw error;
  }
}

export async function syncRepositoryAtPath(localPath: string, remoteUrl: string): Promise<SyncedRepository> {
  const existed = await pathExists(localPath);
  if (!existed) {
    await mkdir(path.dirname(localPath), { recursive: true });
    await runGit(["clone", "--origin", "origin", remoteUrl, localPath], path.dirname(localPath));
  } else {
    await runGit(["-C", localPath, "rev-parse", "--git-dir"], localPath);
    await ensureRemote(localPath, remoteUrl);
    await runGit(["-C", localPath, "fetch", "--prune", "origin"], localPath);
  }

  try {
    await runGit(["-C", localPath, "show-ref", "--verify", "--quiet", "refs/remotes/origin/main"], localPath);
  } catch {
    throw new GitCommandError("GIT_COMMAND_FAILED", "Required remote branch main is missing");
  }
  const sha = await runGit(["-C", localPath, "rev-parse", "refs/remotes/origin/main"], localPath);
  return { mainSha: sha.stdout.trim(), cloned: !existed };
}

export async function syncRepository(repository: GithubSshRepository): Promise<SyncedRepository> {
  return syncRepositoryAtPath(repository.localPath, repository.normalizedSshUrl);
}
