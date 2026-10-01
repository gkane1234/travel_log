import { createHmac, timingSafeEqual } from "node:crypto";
import fs from "node:fs";
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

/** Vite does not always copy .env onto process.env for this middleware. */
function loadLocalEnv(): void {
  const file = path.join(root, ".env");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

loadLocalEnv();

export const SESSION_COOKIE = "author_session";
const SESSION_MS = 1000 * 60 * 60 * 24 * 30;

export function authorConfigured(): boolean {
  return Boolean(
    process.env.AUTHOR_USERNAME &&
      process.env.AUTHOR_PASSWORD &&
      process.env.AUTHOR_SECRET,
  );
}

function hmac(value: string): Buffer {
  return createHmac("sha256", process.env.AUTHOR_SECRET || "").update(value).digest();
}

function safeEqual(a: string, b: string): boolean {
  const left = hmac(a);
  const right = hmac(b);
  return timingSafeEqual(left, right);
}

export function credentialsMatch(username: string, password: string): boolean {
  if (!authorConfigured()) return false;
  return (
    safeEqual(username, process.env.AUTHOR_USERNAME || "") &&
    safeEqual(password, process.env.AUTHOR_PASSWORD || "")
  );
}

export function createSessionToken(username: string): string {
  const payload = Buffer.from(
    JSON.stringify({ u: username, exp: Date.now() + SESSION_MS }),
  ).toString("base64url");
  const sig = hmac(payload).toString("base64url");
  return `${payload}.${sig}`;
}

export function sessionIsValid(token: string | undefined | null): boolean {
  if (!token || !process.env.AUTHOR_SECRET) return false;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return false;
  const payload = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  const expected = hmac(payload).toString("base64url");
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return false;
  try {
    const data = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as {
      u?: string;
      exp?: number;
    };
    if (!data.u || !data.exp || data.exp < Date.now()) return false;
    return safeEqual(data.u, process.env.AUTHOR_USERNAME || "");
  } catch {
    return false;
  }
}

export function tokenFromRequest(request: Request): string | null {
  const cookie = request.headers.get("cookie") || "";
  const match = cookie.match(/(?:^|;\s*)author_session=([^;]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

export function isRequestAuthed(request: Request): boolean {
  return authorConfigured() && sessionIsValid(tokenFromRequest(request));
}

export function sessionCookie(token: string, request: Request): string {
  const secure = new URL(request.url).protocol === "https:";
  const parts = [
    `${SESSION_COOKIE}=${encodeURIComponent(token)}`,
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
    `Max-Age=${Math.floor(SESSION_MS / 1000)}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function clearSessionCookie(request: Request): string {
  const secure = new URL(request.url).protocol === "https:";
  const parts = [
    `${SESSION_COOKIE}=`,
    "HttpOnly",
    "Path=/",
    "SameSite=Lax",
    "Max-Age=0",
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}
