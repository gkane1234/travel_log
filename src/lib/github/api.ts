import { buildCommitRequest, buildTreeRequest, bytesToBase64 } from "./commit-plan.ts";
import type { GithubSettings } from "./settings.ts";

export class GithubError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

type BranchTip = {
  commitSha: string;
  treeSha: string;
};

async function gh(settings: GithubSettings, path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  headers.set("Accept", headers.get("Accept") || "application/vnd.github+json");
  headers.set("Authorization", `Bearer ${settings.token}`);
  headers.set("X-GitHub-Api-Version", "2022-11-28");
  const response = await fetch(`https://api.github.com${path}`, { ...init, headers });
  if (!response.ok) {
    let message = response.statusText || "GitHub request failed";
    try {
      const data = (await response.json()) as { message?: string };
      if (data.message) message = data.message;
    } catch {
      /* keep status text */
    }
    throw new GithubError(friendly(response.status, message), response.status);
  }
  return response;
}

function friendly(status: number, message: string): string {
  if (status === 401) return "GitHub rejected that token.";
  if (status === 403) return "That token cannot change this repository.";
  if (status === 404) return "Could not find that repository or branch.";
  return message;
}

function repoPath(settings: GithubSettings): string {
  return `/repos/${encodeURIComponent(settings.owner)}/${encodeURIComponent(settings.repo)}`;
}

export async function getBranchTip(settings: GithubSettings): Promise<BranchTip> {
  const response = await gh(
    settings,
    `${repoPath(settings)}/branches/${encodeURIComponent(settings.branch)}`,
  );
  const data = (await response.json()) as {
    commit: { sha: string; commit: { tree: { sha: string } } };
  };
  return { commitSha: data.commit.sha, treeSha: data.commit.commit.tree.sha };
}

export async function listTreePaths(settings: GithubSettings, treeSha: string): Promise<string[]> {
  const response = await gh(
    settings,
    `${repoPath(settings)}/git/trees/${treeSha}?recursive=1`,
  );
  const data = (await response.json()) as {
    truncated?: boolean;
    tree: { path: string; type: string }[];
  };
  if (data.truncated) {
    throw new GithubError("This repository is too large to list from the browser.", 422);
  }
  return data.tree.filter((entry) => entry.type === "blob").map((entry) => entry.path);
}

export async function readTextFile(
  settings: GithubSettings,
  path: string,
): Promise<string | null> {
  const response = await fetch(
    `https://api.github.com${repoPath(settings)}/contents/${path
      .split("/")
      .map(encodeURIComponent)
      .join("/")}?ref=${encodeURIComponent(settings.branch)}`,
    {
      headers: {
        Accept: "application/vnd.github.raw",
        Authorization: `Bearer ${settings.token}`,
        "X-GitHub-Api-Version": "2022-11-28",
      },
    },
  );
  if (response.status === 404) return null;
  if (!response.ok) {
    let message = response.statusText;
    try {
      const data = (await response.json()) as { message?: string };
      if (data.message) message = data.message;
    } catch {
      /* raw errors may not be json */
    }
    throw new GithubError(friendly(response.status, message), response.status);
  }
  return response.text();
}

export async function commitFiles(
  settings: GithubSettings,
  message: string,
  files: { path: string; bytes: Uint8Array }[],
  tip: BranchTip,
): Promise<BranchTip> {
  const blobs: { path: string; sha: string }[] = [];
  for (const file of files) {
    const response = await gh(settings, `${repoPath(settings)}/git/blobs`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content: bytesToBase64(file.bytes),
        encoding: "base64",
      }),
    });
    const data = (await response.json()) as { sha: string };
    blobs.push({ path: file.path, sha: data.sha });
  }

  const treeBody = buildTreeRequest(tip.treeSha, blobs);
  const treeResponse = await gh(settings, `${repoPath(settings)}/git/trees`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(treeBody),
  });
  const tree = (await treeResponse.json()) as { sha: string };

  const commitBody = buildCommitRequest(message, tree.sha, tip.commitSha);
  const commitResponse = await gh(settings, `${repoPath(settings)}/git/commits`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(commitBody),
  });
  const commit = (await commitResponse.json()) as { sha: string };

  await gh(settings, `${repoPath(settings)}/git/refs/heads/${encodeURIComponent(settings.branch)}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sha: commit.sha }),
  });

  return { commitSha: commit.sha, treeSha: tree.sha };
}
