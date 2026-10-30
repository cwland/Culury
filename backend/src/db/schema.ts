// Culury database schema (Drizzle ORM)
// After changing this file run: npm run db:generate
import {
  pgTable,
  serial,
  integer,
  text,
  boolean,
  timestamp,
  index,
  uniqueIndex,
  jsonb,
} from "drizzle-orm/pg-core";

export const users = pgTable("users", {
  id: serial("id").primaryKey(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  displayName: text("display_name"),
  email: text("email"), // used for password resets (and later, notifications)
  // Bumped to sign out every device: login tokens carry the version they were issued with
  tokenVersion: integer("token_version").notNull().default(0),
  seenVersion: text("seen_version"), // the app version whose "What's new" was dismissed
  theme: text("theme"), // Settings > Profile > Appearance (null: the default)
  colorMode: text("color_mode"), // light, dark or system (null: system)
  dismissedUpdate: text("dismissed_update"), // the newer version whose top bar was dismissed
  // The OAuth / OpenID Connect identity linked to this account (Settings > Security)
  oauthIssuer: text("oauth_issuer"),
  oauthSubject: text("oauth_subject"),
  oauthEmail: text("oauth_email"), // shown in Settings (what the provider called it)
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// App-wide settings changed from the Settings page (e.g. "email"). Secrets inside are encrypted.
export const appSettings = pgTable("app_settings", {
  key: text("key").primaryKey(),
  value: jsonb("value").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

// One-time password reset links. Only a hash of the token is stored.
export const passwordResets = pgTable("password_resets", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  tokenHash: text("token_hash").notNull().unique(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  usedAt: timestamp("used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Keys for other apps (n8n, Home Assistant, ...). Only a hash is stored.
export const apiKeys = pgTable("api_keys", {
  id: serial("id").primaryKey(),
  name: text("name").notNull(),
  prefix: text("prefix").notNull(), // first characters, shown in the UI to identify the key
  keyHash: text("key_hash").notNull().unique(),
  // What the key may do (see lib/keyAccess.ts)
  access: text("access").notNull().default("read"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
});

// Signed-in devices: one row per sign-in (each login token carries its row's tokenId).
// A session works while it isn't signed out, its token version is current and it hasn't expired.
export const sessions = pgTable(
  "sessions",
  {
    id: serial("id").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenId: text("token_id").notNull().unique(),
    tokenVersion: integer("token_version").notNull(),
    how: text("how").notNull(), // password, setup, reset link, earlier sign-in
    userAgent: text("user_agent"),
    ip: text("ip"), // where it signed in from
    lastIp: text("last_ip"), // where it was last used from
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }), // signed out
    // A random id the browser keeps (localStorage), so signing in again in the same browser reuses
    // its row: one row per browser in Signed-in devices. Null for sessions from before this.
    deviceId: text("device_id"),
  },
  (t) => [index("sessions_user_idx").on(t.userId), uniqueIndex("sessions_user_device_idx").on(t.userId, t.deviceId)]
);

// Every sign-in attempt, good or bad (Settings > Security)
export const loginEvents = pgTable(
  "login_events",
  {
    id: serial("id").primaryKey(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    username: text("username"), // as typed
    success: boolean("success").notNull(),
    reason: text("reason"), // why it failed, or how it signed in
    ip: text("ip"),
    userAgent: text("user_agent"),
    sessionId: integer("session_id").references(() => sessions.id, { onDelete: "set null" }),
  },
  (t) => [index("login_events_at_idx").on(t.at)]
);

// Passkeys (WebAuthn): sign in with a fingerprint, face or device PIN instead of the password.
// Each one belongs to the web address it was made on (rp_id), e.g. localhost or your domain.
export const passkeys = pgTable("passkeys", {
  id: serial("id").primaryKey(),
  userId: integer("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  credentialId: text("credential_id").notNull().unique(), // base64url
  publicKey: text("public_key").notNull(), // base64url (COSE)
  counter: integer("counter").notNull().default(0),
  transports: jsonb("transports").$type<string[]>(),
  rpId: text("rp_id").notNull(), // the address it works on (no port), e.g. recipes.example.com
  name: text("name").notNull(), // shown in Settings > Security
  deviceType: text("device_type"), // singleDevice / multiDevice (synced, e.g. iCloud Keychain)
  backedUp: boolean("backed_up").notNull().default(false),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
});

// Settings > Logs: emails sent, AI problems, API errors, and scheduled task
// runs (backups, imports...). Only short descriptions, never message bodies or
// secrets. Kept for 30 days.
export const appLog = pgTable(
  "app_log",
  {
    id: serial("id").primaryKey(),
    at: timestamp("at", { withTimezone: true }).notNull().defaultNow(),
    category: text("category").notNull(), // email, ai, api, schedule
    level: text("level").notNull(), // info, warning, error
    source: text("source"), // which one: an email type, AI service, bank, task name, API key...
    event: text("event").notNull(), // one line: what happened
    detail: text("detail"), // the error message, counts, etc.
  },
  (t) => [index("app_log_at_idx").on(t.at)]
);
