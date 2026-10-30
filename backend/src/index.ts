import "dotenv/config";
import path from "node:path";
import { createDb } from "./db/index.js";
import { runMigrations } from "./db/migrate.js";
import { buildApp, defaultBackupDir } from "./app.js";
import { startBackupSchedule } from "./lib/backup.js";
import { startReminderSchedule } from "./lib/reminders.js";
import { emailConfigFromEnv } from "./lib/mail.js";
import { logEvent } from "./lib/appLog.js";
import { emergencyResetAuth } from "./lib/oauth.js";
import { serveWeb } from "./web.js";

const { db } = createDb(process.env.DATABASE_URL!);
await runMigrations(db);

const backupDir = process.env.BACKUP_DIR || defaultBackupDir;
const backupKeep = Number(process.env.BACKUP_KEEP ?? 30);

const app = buildApp({
  db,
  jwtSecret: process.env.JWT_SECRET ?? "",
  logger: true,
  backupDir,
  backupKeep,
  emailEnv: emailConfigFromEnv(process.env),
});

// Production (Docker): the API also serves the built web app from WEB_DIR
if (process.env.WEB_DIR) await serveWeb(app, path.resolve(process.env.WEB_DIR));

// Background jobs (recipe imports). Once a day: old finished jobs and unused photos are cleared away.
await app.jobs.start(async () => {
  const removed = await app.photos.sweep(db);
  if (removed) app.log.info(`Removed ${removed} unused photo(s)`);
});

// Daily automatic backup (set BACKUP_ENABLED=false to turn off)
if (process.env.BACKUP_ENABLED !== "false") {
  startBackupSchedule(db, backupDir, backupKeep, {
    info: (msg) => app.log.info(msg),
    error: (err) => app.log.error(err),
  }, app.backupSecrets(), app.photos.dir);
}
// Daily meal plan emails (each person picks a time in Settings › Profile)
startReminderSchedule(db, app.mail, app.now, (err) => app.log.error(err));

// Emergency: EMERGENCY_DISABLE_OAUTH=true turns password sign-in back on (and OAuth off) at start
if (process.env.EMERGENCY_DISABLE_OAUTH === "true") {
  const r = await emergencyResetAuth(db);
  app.log.warn(`EMERGENCY_DISABLE_OAUTH: password sign-in is on again (was ${r.was.authMode}, OAuth ${r.was.enabled ? "on" : "off"}). Remove the setting once you're back in.`);
  await logEvent(db, { category: "api", level: "warning", source: "EMERGENCY_DISABLE_OAUTH", event: "OAuth turned off and password sign-in turned back on at start" });
}

// Remind on every start: the backup key can't be recovered
if (app.backupKey.key) app.log.info("BACKUP_KEY is set: saved keys and passwords go into backups, encrypted. Save a copy of BACKUP_KEY somewhere safe, away from this server; restoring them needs it.");
else if (app.backupKey.problem) app.log.warn(app.backupKey.problem);

// Release watcher: look for a newer release on GitHub every few hours (UPDATE_CHECK_HOURS=0 turns
// the schedule off; Settings > Data > Updates turns checking off altogether)
const updateHours = Number(process.env.UPDATE_CHECK_HOURS ?? 3);
if (updateHours > 0) {
  const checkUpdates = () => app.updates.check().catch((err) => app.log.error(err));
  setTimeout(checkUpdates, 30 * 1000);
  setInterval(checkUpdates, updateHours * 60 * 60 * 1000);
}

const port = Number(process.env.PORT ?? 4000);

app.listen({ port, host: "0.0.0.0" }).catch((err) => {
  app.log.error(err);
  process.exit(1);
});
