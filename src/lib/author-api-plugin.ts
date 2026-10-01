import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import { handleAuthorRequest } from "./author-http";

async function readBody(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

async function toWebRequest(req: IncomingMessage): Promise<Request> {
  const host = req.headers.host || "localhost";
  const url = `http://${host}${req.url || "/"}`;
  const method = req.method || "GET";
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (value === undefined) continue;
    headers.set(key, Array.isArray(value) ? value.join(", ") : value);
  }
  const hasBody = method !== "GET" && method !== "HEAD";
  const body = hasBody ? await readBody(req) : undefined;
  return new Request(url, { method, headers, body });
}

async function writeResponse(res: ServerResponse, response: Response): Promise<void> {
  res.statusCode = response.status;
  response.headers.forEach((value, key) => {
    if (key.toLowerCase() === "set-cookie") return;
    res.setHeader(key, value);
  });
  const cookies = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [];
  if (cookies.length) res.setHeader("Set-Cookie", cookies);
  res.end(Buffer.from(await response.arrayBuffer()));
}

/** Dev server entry for the same author handler the production Node server uses. */
export function authorApiPlugin(): Plugin {
  return {
    name: "author-api",
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (!req.url?.startsWith("/api/author")) return next();
        try {
          const request = await toWebRequest(req);
          const response = await handleAuthorRequest(request);
          await writeResponse(res, response);
        } catch (e) {
          const message = e instanceof Error ? e.message : "Error";
          res.statusCode = 500;
          res.setHeader("Content-Type", "application/json");
          res.end(JSON.stringify({ error: message }));
        }
      });
    },
  };
}
