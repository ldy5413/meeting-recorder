import { createServer } from "node:http";
import { randomBytes } from "node:crypto";
import {
  readFileSync,
  writeFileSync,
  createReadStream,
  statSync,
} from "node:fs";
import { join, extname, resolve, sep } from "node:path";

/** Explicit development-only transport; the caller must also reject packaged apps. */
export async function startDevBridge(options: {
  dist: string;
  userData: string;
  dispatch: (input: unknown) => Promise<unknown>;
  audio: (name: string) => string | undefined;
  frame?: (name: string) => string | undefined;
}) {
  const token = randomBytes(32).toString("hex");
  let origin = "";
  const server = createServer(async (req, res) => {
    res.setHeader("Cache-Control", "no-store");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader("X-Content-Type-Options", "nosniff");
    try {
      if (req.headers.host !== new URL(origin).host) {
        res.writeHead(403).end();
        return;
      }
      const url = new URL(req.url || "/", origin);
      if (
        req.method === "GET" &&
        url.pathname === "/" &&
        url.searchParams.get("token") === token
      ) {
        res.setHeader(
          "Set-Cookie",
          `meeting_dev=${token}; HttpOnly; SameSite=Strict; Path=/`,
        );
        res.writeHead(303, { Location: "/" }).end();
        return;
      }
      const authenticated =
        req.headers.authorization === `Bearer ${token}` ||
        req.headers.cookie?.split("; ").includes(`meeting_dev=${token}`);
      if (
        !authenticated ||
        (req.headers.origin && req.headers.origin !== origin)
      ) {
        res.writeHead(403).end();
        return;
      }
      if (req.method === "POST" && url.pathname === "/api/request") {
        if (
          req.headers.origin !== origin ||
          req.headers["content-type"] !== "application/json"
        ) {
          res.writeHead(403).end();
          return;
        }
        const parts: Buffer[] = [];
        let length = 0;
        for await (const part of req) {
          length += part.length;
          if (length > 8 * 1024 * 1024) {
            res.writeHead(413).end();
            return;
          }
          parts.push(part);
        }
        const result = await options.dispatch(
          JSON.parse(Buffer.concat(parts).toString("utf8")),
        );
        res
          .writeHead(200, { "Content-Type": "application/json; charset=utf-8" })
          .end(JSON.stringify(result));
        return;
      }
      if (req.method !== "GET") {
        res.writeHead(405).end();
        return;
      }
      const isAudio = url.pathname.startsWith("/audio/");
      const isFrame = url.pathname.startsWith("/frames/");
      const path = isFrame
        ? options.frame?.(url.pathname.slice(8))
        : isAudio
          ? options.audio(url.pathname.slice(7))
          : resolve(
              options.dist,
              `.${url.pathname === "/" ? "/index.html" : url.pathname}`,
            );
      if (
        !path ||
        (!isAudio && !isFrame && !path.startsWith(resolve(options.dist) + sep))
      ) {
        res.writeHead(404).end();
        return;
      }
      const size = statSync(path).size;
      let start = 0,
        end = size - 1;
      const range = req.headers.range;
      if (range) {
        const match = /^bytes=(\d+)-(\d*)$/.exec(range);
        if (!match) {
          res.writeHead(416).end();
          return;
        }
        start = Number(match[1]);
        end = match[2] ? Math.min(Number(match[2]), end) : end;
        if (start > end || start >= size) {
          res.writeHead(416).end();
          return;
        }
      }
      const mime: Record<string, string> = {
        ".html": "text/html; charset=utf-8",
        ".js": "text/javascript",
        ".css": "text/css",
        ".wav": "audio/wav",
        ".mp3": "audio/mpeg",
        ".m4a": "audio/mp4",
        ".flac": "audio/flac",
        ".ogg": "audio/ogg",
        ".webm": "video/webm",
        ".jpg": "image/jpeg",
        ".mp4": "video/mp4",
      };
      res.writeHead(range ? 206 : 200, {
        "Content-Type": mime[extname(path)] || "application/octet-stream",
        "Content-Length": end - start + 1,
        "Accept-Ranges": "bytes",
        ...(range ? { "Content-Range": `bytes ${start}-${end}/${size}` } : {}),
      });
      createReadStream(path, { start, end })
        .on("error", () => res.destroy())
        .pipe(res);
    } catch {
      if (!res.headersSent) res.writeHead(400);
      res.end();
    }
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  const address = server.address();
  if (!address || typeof address === "string")
    throw new Error("Missing dev bridge port");
  origin = `http://127.0.0.1:${address.port}`;
  writeFileSync(
    join(options.userData, "dev-bridge.json"),
    JSON.stringify({ origin, token, userData: options.userData }),
    { mode: 0o600 },
  );
  console.log(
    `Development browser bridge: ${origin} (bootstrap credentials in userData/dev-bridge.json)`,
  );
  return server;
}
