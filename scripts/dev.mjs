/**
 * Ensure only one Astro dev server for this project.
 * Extra processes both write `.astro/data-store.json.tmp` and crash on Windows.
 */
import { execSync, spawn } from "node:child_process";
import net from "node:net";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const PORT = Number(process.env.PORT || 4321);
const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const astroCli = path.join(root, "node_modules", "astro", "astro.js");

function pidsOnPort(port) {
  const pids = new Set();

  if (process.platform === "win32") {
    // Include IPv4 and IPv6 (::1). `-p tcp` alone misses IPv6 listeners.
    try {
      const out = execSync("netstat -ano", { encoding: "utf8" });
      for (const line of out.split(/\r?\n/)) {
        if (!/LISTENING/i.test(line)) continue;
        // Match :4321 or ]:4321 (IPv6)
        if (!new RegExp(`:${port}\\s`).test(line)) continue;
        const parts = line.trim().split(/\s+/);
        const pid = Number(parts.at(-1));
        if (pid) pids.add(pid);
      }
    } catch {
      /* ignore */
    }
    try {
      const ps = execSync(
        `powershell -NoProfile -Command "Get-NetTCPConnection -LocalPort ${port} -State Listen -ErrorAction SilentlyContinue | Select-Object -ExpandProperty OwningProcess -Unique"`,
        { encoding: "utf8" },
      );
      for (const line of ps.split(/\r?\n/)) {
        const pid = Number(line.trim());
        if (pid) pids.add(pid);
      }
    } catch {
      /* ignore */
    }
  } else {
    try {
      const out = execSync(`lsof -ti tcp:${port} -sTCP:LISTEN`, {
        encoding: "utf8",
      }).trim();
      for (const id of out.split(/\s+/)) {
        const pid = Number(id);
        if (pid) pids.add(pid);
      }
    } catch {
      /* ignore */
    }
  }

  return [...pids];
}

/** Also kill leftover `astro.js dev` for this repo (e.g. bound to another port). */
function killSiblingAstroDev() {
  if (process.platform !== "win32") return;
  try {
    const out = execSync(
      `powershell -NoProfile -Command "Get-CimInstance Win32_Process -Filter \\"Name='node.exe'\\" | Where-Object { $_.CommandLine -match 'astro\\\\astro\\.js' -and $_.CommandLine -match 'dev' -and $_.CommandLine -match 'travel_log' } | ForEach-Object { $_.ProcessId }"`,
      { encoding: "utf8" },
    );
    for (const line of out.split(/\r?\n/)) {
      const pid = Number(line.trim());
      if (pid && pid !== process.pid) killPid(pid);
    }
  } catch {
    /* ignore */
  }
}

function killPid(pid) {
  try {
    if (process.platform === "win32") {
      execSync(`taskkill /PID ${pid} /T /F`, { stdio: "ignore" });
    } else {
      try {
        process.kill(-pid, "SIGTERM");
      } catch {
        process.kill(pid, "SIGTERM");
      }
    }
    console.log(`[dev] stopped stale process tree ${pid}`);
  } catch {
    /* already gone */
  }
}

function portFree(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once("error", () => resolve(false));
    server.once("listening", () => {
      server.close(() => resolve(true));
    });
    // Bind IPv4; also check IPv6 separately below via pidsOnPort.
    server.listen(port, "127.0.0.1");
  });
}

async function freePort() {
  for (const pid of pidsOnPort(PORT)) {
    if (pid !== process.pid) killPid(pid);
  }
  killSiblingAstroDev();
  for (let i = 0; i < 40; i++) {
    if (pidsOnPort(PORT).length === 0 && (await portFree(PORT))) return true;
    await new Promise((r) => setTimeout(r, 100));
  }
  return pidsOnPort(PORT).length === 0;
}

if (!(await freePort())) {
  console.error(
    `[dev] Port ${PORT} is still in use after trying to free it. Stop the other process and retry.`,
  );
  process.exit(1);
}

const child = spawn(
  process.execPath,
  [astroCli, "dev", "--port", String(PORT), "--strictPort", ...process.argv.slice(2)],
  {
    stdio: "inherit",
    cwd: root,
    env: process.env,
    detached: process.platform !== "win32",
  },
);

const shutdown = () => {
  if (!child.killed && child.pid) {
    try {
      if (process.platform === "win32") {
        execSync(`taskkill /PID ${child.pid} /T /F`, { stdio: "ignore" });
      } else {
        process.kill(-child.pid, "SIGTERM");
      }
    } catch {
      child.kill("SIGTERM");
    }
  }
};

process.on("SIGINT", () => {
  shutdown();
  process.exit(0);
});
process.on("SIGTERM", () => {
  shutdown();
  process.exit(0);
});

child.on("exit", (code, signal) => {
  if (signal) process.exit(1);
  process.exit(code ?? 0);
});
