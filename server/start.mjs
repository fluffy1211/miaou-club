// The Node adapter exposes a standalone handler; guard images before its static server.
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { writeResponse } from "astro/app/node";
process.env.ASTRO_NODE_AUTOSTART = "disabled";
const { handler } = await import("../dist/server/entry.mjs");
const { handleRequest, dispose } =
  await import("../dist/backend/http/runtime.js");
const baseURL = process.env.BETTER_AUTH_URL;
if (!baseURL) throw new Error("BETTER_AUTH_URL is required");
const server = createServer(async (req, res) => {
  const started = performance.now();
  const requestId = randomUUID();
  res.setHeader("X-Request-Id", requestId);
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("Referrer-Policy", "same-origin");
  res.once("finish", () =>
    console.log(
      JSON.stringify({
        requestId,
        status: res.statusCode,
        durationMs: Math.round(performance.now() - started),
      }),
    ),
  );
  try {
    const path = decodeURIComponent(new URL(req.url ?? "/", baseURL).pathname);
    if (
      path === "/_image" ||
      /\.(?:avif|webp|jpe?g|png|gif|svg|heic)$/i.test(path)
    ) {
      const access = await handleRequest(
        new Request(new URL("/api/v1/access", baseURL), {
          headers: req.headers.cookie ? { cookie: req.headers.cookie } : {},
        }),
      );
      if (access.status !== 200) {
        await writeResponse(access, res);
        return;
      }
      // The adapter normally marks hashed assets public/immutable.
      const original = res.setHeader.bind(res);
      res.setHeader = (name, value) =>
        original(
          name,
          name.toLowerCase() === "cache-control" ? "no-store" : value,
        );
      res.setHeader("Cache-Control", "no-store");
    }
    handler(req, res);
  } catch {
    res.writeHead(503, {
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    });
    res.end(JSON.stringify({ code: "unavailable" }));
  }
});
server.requestTimeout = 15000;
server.headersTimeout = 10000;
server.listen(
  Number(process.env.PORT ?? 4321),
  process.env.HOST ?? "127.0.0.1",
);
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  const deadline = setTimeout(() => process.exit(1), 5000).unref();
  server.closeAllConnections();
  await new Promise((resolve) => server.close(resolve));
  await dispose();
  clearTimeout(deadline);
  process.exit(0);
}
process.once("SIGTERM", () => {
  void stop();
});
process.once("SIGINT", () => {
  void stop();
});
