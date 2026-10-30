import { asc, sql } from "drizzle-orm";
import type { PgTable } from "drizzle-orm/pg-core";
import { z } from "zod";
import type { Db } from "../db/index.js";
import { exportSettings, importSettings, type BackupSecrets, type SettingsSection } from "./settingsBackup.js";

export const EXPORT_VERSION = 1;

// The data tables that go into exports and backups, in an order that restores cleanly (a table
// comes after the tables it points at). Each feature adds its tables here as it's built.
// Not included: the login, API keys, signed-in devices, sign-in history and logs.
export const DATA_TABLES: { name: string; key: string; table: PgTable & { id: unknown } }[] = [];

// Everything in DATA_TABLES, plus settings (their saved keys and passwords only when BACKUP_KEY is
// set, encrypted with it; see settingsBackup.ts)
export async function buildExport(db: Db, secrets: BackupSecrets) {
  const data: Record<string, unknown[]> = {};
  for (const t of DATA_TABLES) data[t.key] = await db.select().from(t.table).orderBy(asc(t.table.id as never));
  return {
    app: "Culury",
    exportVersion: EXPORT_VERSION,
    exportedAt: new Date().toISOString(),
    data,
    settings: await exportSettings(db, secrets),
  };
}

// ---------- CSV ----------

export function toCsv(rows: (string | number | null | undefined)[][]) {
  const cell = (v: string | number | null | undefined) => {
    let s = v === null || v === undefined ? "" : String(v);
    // Stop spreadsheet apps from treating text like "=SUM(...)" as a formula
    if (typeof v === "string" && /^[=+\-@\t\r]/.test(s) && !/^-?\d+(\.\d+)?$/.test(s)) s = `'${s}`;
    return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return rows.map((r) => r.map(cell).join(",")).join("\r\n") + "\r\n";
}

// ---------- Restore ----------

export const importSchema = z.object({
  app: z.literal("Culury"),
  exportVersion: z.literal(1),
  data: z.record(z.string(), z.array(z.record(z.string(), z.unknown()))),
  settings: z.object({ secrets: z.enum(["encrypted", "left out"]), values: z.record(z.string(), z.unknown()) }).optional(),
});
export type ImportData = z.infer<typeof importSchema>;

// JSON turns dates into strings; turn timestamp fields back into Dates
const TIMESTAMP = /(At|_at)$/;
function revive(row: Record<string, unknown>) {
  const out: Record<string, unknown> = { ...row };
  for (const [k, v] of Object.entries(out)) if (TIMESTAMP.test(k) && typeof v === "string") out[k] = new Date(v);
  return out;
}

type Tx = Parameters<Parameters<Db["transaction"]>[0]>[0];
async function insertChunks(tx: Tx, table: PgTable, rows: Record<string, unknown>[]) {
  for (let i = 0; i < rows.length; i += 500) await tx.insert(table).values(rows.slice(i, i + 500).map(revive) as never);
}

// Replaces ALL data in DATA_TABLES with the backup's contents (the login and API keys are kept).
// Runs in one database transaction, so a bad file changes nothing.
export async function importData(db: Db, data: ImportData, secrets: BackupSecrets) {
  let settings: Awaited<ReturnType<typeof importSettings>> | null = null;
  const counts: Record<string, number> = {};
  await db.transaction(async (tx) => {
    if (DATA_TABLES.length) await tx.execute(sql.raw(`truncate ${DATA_TABLES.map((t) => `"${t.name}"`).join(", ")} restart identity cascade`));
    for (const t of DATA_TABLES) {
      const rows = data.data[t.key] ?? [];
      counts[t.key] = rows.length;
      if (rows.length) await insertChunks(tx, t.table, rows);
      // New rows should get ids after the restored ones
      await tx.execute(sql.raw(`select setval(pg_get_serial_sequence('"${t.name}"', 'id'), coalesce((select max(id) from "${t.name}"), 0) + 1, false)`));
    }
    if (data.settings) settings = await importSettings(tx as unknown as Db, data.settings as SettingsSection, secrets);
  });
  // settings null: a backup without settings (yours were left as they are)
  return { counts, settings };
}
