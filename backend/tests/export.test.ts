import fs from "node:fs";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { setupTestApp, type TestApp } from "./helpers.js";
import { toCsv } from "../src/lib/dataExport.js";

let t: TestApp;
beforeAll(async () => (t = await setupTestApp()));
beforeEach(async () => {
  await t.reset();
  for (const f of fs.readdirSync(t.backupDir)) fs.unlinkSync(`${t.backupDir}/${f}`);
  await t.login();
});
afterAll(async () => t.close());

const raw = async (url: string) => {
  const login = await t.api("POST", "/api/auth/login", { username: "cory", password: "password123" });
  return t.app.inject({ method: "GET", url, headers: { authorization: `Bearer ${login.body.token}` } });
};

describe("CSV", () => {
  it("quotes commas and defuses formulas", () => {
    expect(toCsv([["Name", "Note"], ["Salt, kosher", '=HYPERLINK("x")'], ["-1", 2]])).toBe('Name,Note\r\n"Salt, kosher","\'=HYPERLINK(""x"")"\r\n-1,2\r\n');
  });
});

describe("backups", () => {
  it("backs up now, lists, downloads, and prunes to the keep limit", async () => {
    const made = await t.api("POST", "/api/backups");
    expect(made.status).toBe(201);
    expect(made.body.name).toMatch(/^culury-\d{4}-\d{2}-\d{2}-\d{6}\.json$/);

    const list = await t.api("GET", "/api/backups");
    expect(list.body.backups).toHaveLength(1);
    expect(list.body.keep).toBe(3);

    const dl = await raw(`/api/backups/${made.body.name}`);
    expect(dl.statusCode).toBe(200);
    expect(JSON.parse(dl.body)).toMatchObject({ app: "Culury", exportVersion: 1, data: {} });

    // keep = 3: older files are removed
    for (let i = 0; i < 4; i++) fs.writeFileSync(`${t.backupDir}/culury-2020-01-0${i + 1}-000000.json`, "{}");
    await t.api("POST", "/api/backups");
    const after = (await t.api("GET", "/api/backups")).body.backups.map((b: { name: string }) => b.name);
    expect(after).toHaveLength(3);
    expect(after.some((n: string) => n.startsWith("culury-2020-01-01"))).toBe(false);
  });

  it("won't serve files outside the backup folder", async () => {
    expect((await raw("/api/backups/..%2F..%2Fpackage.json")).statusCode).toBe(404);
    expect((await raw("/api/backups/passwd")).statusCode).toBe(404);
  });
});

describe("restore", () => {
  it("round-trips settings and keeps the login", async () => {
    await t.api("PUT", "/api/settings/features", { apiKeys: true, ai: false });
    const exported = JSON.parse((await raw("/api/export")).body);
    await t.api("PUT", "/api/settings/features", { apiKeys: false });

    const res = await t.api("POST", "/api/import?confirm=replace", exported);
    expect(res.status).toBe(200);
    expect(res.body.safetyBackup).toMatch(/before-restore\.json$/);
    expect((await t.api("GET", "/api/settings/features")).body).toEqual({ apiKeys: true, ai: false });
    expect((await t.api("GET", "/api/auth/me")).body.user.username).toBe("cory");
  });

  it("requires confirm=replace and a Culury file", async () => {
    const exported = JSON.parse((await raw("/api/export")).body);
    expect((await t.api("POST", "/api/import", exported)).status).toBe(400);
    const r = await t.api("POST", "/api/import?confirm=replace", { ...exported, app: "Zero Smart Budget" });
    expect([r.status, r.body.error]).toEqual([400, "That file isn't a Culury backup"]);
  });

  it("API keys can't restore, even admin keys", async () => {
    const key = (await t.api("POST", "/api/keys", { name: "n8n", access: "admin" })).body.key;
    const exported = JSON.parse((await raw("/api/export")).body);
    t.setToken("");
    expect((await t.api("POST", "/api/import?confirm=replace", exported, { "x-api-key": key })).status).toBe(403);
  });
});
