import fs from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

function projectRoot(): string {
  const cwd = process.cwd();
  if (
    fs.existsSync(path.join(cwd, "trips")) &&
    fs.existsSync(path.join(cwd, "astro.config.mjs"))
  ) {
    return cwd;
  }
  return path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
}

const root = projectRoot();

export type BackupResult = {
  committed: boolean;
  warning?: string;
};

function oneLine(text: string): string {
  return text.replace(/\s+/g, " ").trim().slice(0, 240);
}

function runGit(args: string[]): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn("git", args, { cwd: root, windowsHide: true });
    let stdout = "";
    let stderr = "";
    child.stdout?.on("data", (d) => {
      stdout += String(d);
    });
    child.stderr?.on("data", (d) => {
      stderr += String(d);
    });
    child.on("error", (err) => {
      resolve({ code: 1, stdout, stderr: err.message });
    });
    child.on("close", (code) => {
      resolve({ code: code ?? 1, stdout, stderr });
    });
  });
}

async function ensureGitRepo(): Promise<void> {
  const check = await runGit(["rev-parse", "--is-inside-work-tree"]);
  if (check.code === 0) return;
  const init = await runGit(["init"]);
  if (init.code !== 0) {
    throw new Error(oneLine(init.stderr || init.stdout || "git init failed"));
  }
}

/** Only trip content may be auto-committed from the author tool. */
function assertTripPath(rel: string): string {
  const normalized = rel.replace(/\\/g, "/").replace(/^\/+/, "");
  if (!normalized.startsWith("trips/") || normalized.split("/").includes("..")) {
    throw new Error("Refusing to back up a path outside trips/");
  }
  return normalized;
}

/**
 * Commit the given trip paths. A failed backup never throws: the caller
 * should keep the user's save and surface `warning`.
 */
export async function commitTripPaths(
  paths: string[],
  message: string,
): Promise<BackupResult> {
  try {
    await ensureGitRepo();
    const safe = [...new Set(paths.map(assertTripPath))];
    const cleanMessage = message.replace(/[\r\n]+/g, " ").trim().slice(0, 200);
    if (!cleanMessage) {
      return { committed: false, warning: "Backup skipped: empty commit message." };
    }
    if (safe.length === 0) {
      return { committed: false };
    }

    const add = await runGit(["add", "--", ...safe]);
    if (add.code !== 0) {
      return {
        committed: false,
        warning: `Backup failed: ${oneLine(add.stderr || add.stdout || "git add failed")}`,
      };
    }

    const staged = await runGit(["diff", "--cached", "--quiet", "--", ...safe]);
    if (staged.code === 0) return { committed: false };
    if (staged.code !== 1) {
      return {
        committed: false,
        warning: `Backup failed: ${oneLine(staged.stderr || staged.stdout || "could not check changes")}`,
      };
    }

    const commit = await runGit(["commit", "-m", cleanMessage, "--", ...safe]);
    if (commit.code !== 0) {
      return {
        committed: false,
        warning: `Backup failed: ${oneLine(commit.stderr || commit.stdout || "git commit failed")}`,
      };
    }
    return { committed: true };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Backup failed";
    return { committed: false, warning: msg };
  }
}
