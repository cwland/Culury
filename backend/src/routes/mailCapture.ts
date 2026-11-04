import type { FastifyInstance, FastifyRequest } from "fastify";
import { z } from "zod";
import { HttpError } from "../lib/errors.js";

// Settings › Email › Send recipes to Culury by email (lib/mailCapture.ts). The password is never
// sent back.
function requireLogin(req: FastifyRequest) {
  if (req.auth?.method !== "token") throw new HttpError(403, "Log in to do this");
  return req.auth.userId;
}

const captureSettings = z.object({
  enabled: z.boolean(),
  host: z.string().trim().min(1, "Enter the mail server").max(255),
  port: z.coerce.number().int().min(1).max(65535),
  secure: z.boolean(),
  username: z.string().trim().min(1, "Enter the mailbox's username").max(255),
  password: z.string().max(500).nullish(), // left out: keep the saved one
  mailbox: z.string().trim().max(200).default("INBOX"),
  allowedSenders: z.array(z.string().trim().max(255)).max(50).default([]),
});

export default async function mailCaptureRoutes(app: FastifyInstance) {
  const capture = app.mailCapture;

  app.get("/api/settings/mail-capture", async (req) => {
    requireLogin(req);
    const s = await capture.stored();
    return {
      configured: !!s,
      settings: s ? { enabled: s.enabled, host: s.host, port: s.port, secure: s.secure, username: s.username, mailbox: s.mailbox, allowedSenders: s.allowedSenders, hasPassword: !!s.passwordEnc } : null,
      status: await capture.status(),
    };
  });

  app.put("/api/settings/mail-capture", async (req) => {
    requireLogin(req);
    await capture.save(captureSettings.parse(req.body));
    return { ok: true };
  });

  app.delete("/api/settings/mail-capture", async (req, reply) => {
    requireLogin(req);
    await capture.clear();
    return reply.status(204).send();
  });

  // Connect with the settings as typed (a blank password: the saved one), or the saved ones
  app.post("/api/settings/mail-capture/test", async (req) => {
    requireLogin(req);
    const body = req.body && Object.keys(req.body as object).length ? captureSettings.parse(req.body) : undefined;
    try {
      return { ok: true, message: await capture.test(body) };
    } catch (e) {
      throw new HttpError(400, (e as Error).message);
    }
  });

  // Check now
  app.post("/api/settings/mail-capture/check", async (req) => {
    requireLogin(req);
    try {
      return await capture.check();
    } catch (e) {
      throw new HttpError(400, (e as Error).message);
    }
  });
}
