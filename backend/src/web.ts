import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import fastifyStatic from "@fastify/static";

// Production: serve the built web app (frontend/dist) from the API, so Docker runs one container.
// The app uses #/ addresses, so every page is index.html; anything that isn't a file or /api is too.
export async function serveWeb(app: FastifyInstance, dir: string) {
  if (!fs.existsSync(path.join(dir, "index.html"))) {
    app.log.warn(`WEB_DIR=${dir} has no index.html: the web app isn't served`);
    return;
  }
  await app.register(fastifyStatic, {
    root: dir,
    wildcard: false,
    cacheControl: false, // set below instead
    // Built files in assets/ have a hash in their name and never change; everything else
    // (index.html, the icon, the manifest) is checked each time
    setHeaders: (res, file) => res.setHeader("Cache-Control", file.startsWith(path.join(dir, "assets") + path.sep) ? "public, max-age=31536000, immutable" : "no-cache"),
  });
  app.get("/*", (req, reply) => {
    const rel = decodeURIComponent(req.url.split("?")[0]).replace(/^\/+/, "");
    const file = path.join(dir, rel);
    if (rel && file.startsWith(dir + path.sep) && fs.existsSync(file) && fs.statSync(file).isFile()) return reply.sendFile(rel);
    return reply.header("Cache-Control", "no-cache").sendFile("index.html");
  });
}
