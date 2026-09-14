import { createHash } from "node:crypto";
import path from "node:path";

export class InvalidGithubSshUrlError extends Error {
  constructor() {
    super("Repository URL must be a GitHub SSH URL in git@github.com:owner/repository.git form");
    this.name = "InvalidGithubSshUrlError";
  }
}

export interface GithubSshRepository {
  owner: string;
  repository: string;
  name: string;
  normalizedSshUrl: string;
  id: string;
  relativePath: string;
  localPath: string;
}

function validSegment(value: string): boolean {
  return value.length > 0 && value !== "." && value !== ".." && /^[a-z0-9_.-]+$/i.test(value);
}

function parsePath(value: string): { owner: string; repository: string } {
  const segments = value.split("/");
  if (segments.length !== 2) throw new InvalidGithubSshUrlError();
  const owner = segments[0];
  const repositoryWithSuffix = segments[1];
  const repository = repositoryWithSuffix?.endsWith(".git")
    ? repositoryWithSuffix.slice(0, -4)
    : repositoryWithSuffix;
  if (!owner || !repository || !validSegment(owner) || !validSegment(repository)) {
    throw new InvalidGithubSshUrlError();
  }
  return { owner: owner.toLowerCase(), repository: repository.toLowerCase() };
}

function parseRawUrl(rawUrl: string): { owner: string; repository: string } {
  const value = rawUrl.trim();
  const scp = /^git@github\.com:(.+)$/i.exec(value);
  if (scp) {
    if (!scp[1]) throw new InvalidGithubSshUrlError();
    return parsePath(scp[1]);
  }

  if (!value.toLowerCase().startsWith("ssh://")) throw new InvalidGithubSshUrlError();
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new InvalidGithubSshUrlError();
  }
  if (url.protocol !== "ssh:" || url.hostname.toLowerCase() !== "github.com" || url.username !== "git" || (url.port && url.port !== "22")) {
    throw new InvalidGithubSshUrlError();
  }
  if (url.search || url.hash) throw new InvalidGithubSshUrlError();
  return parsePath(url.pathname.replace(/^\//, ""));
}

export function parseGithubSshUrl(rawUrl: string, checkoutRoot: string): GithubSshRepository {
  const { owner, repository } = parseRawUrl(rawUrl);
  const normalizedSshUrl = `git@github.com:${owner}/${repository}.git`;
  const relativePath = path.join(owner, repository);
  return {
    owner,
    repository,
    name: `${owner}/${repository}`,
    normalizedSshUrl,
    id: `repo_${createHash("sha256").update(normalizedSshUrl).digest("hex").slice(0, 24)}`,
    relativePath,
    localPath: path.resolve(checkoutRoot, relativePath),
  };
}
