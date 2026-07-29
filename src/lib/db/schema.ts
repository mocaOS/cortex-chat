import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core";

// API keys issued by the library-backend, stored encrypted (AES-256-GCM).
// One row per backend key; referenced polymorphically by groups.chatKeyId (read)
// and users.contentKeyId (manage).
export const apiKeys = sqliteTable("api_keys", {
  id: text("id").primaryKey(),
  backendKeyId: text("backend_key_id").notNull(),
  encryptedValue: text("encrypted_value").notNull(), // base64: iv|ciphertext|tag
  permission: text("permission", { enum: ["read", "manage"] }).notNull(),
  // JSON-encoded array of collection ids; "[]" means all collections.
  collectionIds: text("collection_ids").notNull().default("[]"),
  label: text("label").notNull().default(""),
  createdAt: integer("created_at").notNull().default(sql`(unixepoch() * 1000)`),
});

export const groups = sqliteTable("groups", {
  id: text("id").primaryKey(),
  name: text("name").notNull().unique(),
  description: text("description").notNull().default(""),
  chatKeyId: text("chat_key_id").references(() => apiKeys.id, {
    onDelete: "set null",
  }),
  createdAt: integer("created_at").notNull().default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updated_at").notNull().default(sql`(unixepoch() * 1000)`),
});

export const users = sqliteTable("users", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  username: text("username").notNull().default(""),
  avatarPath: text("avatar_path"),
  role: text("role", { enum: ["user", "admin", "superadmin"] })
    .notNull()
    .default("user"),
  groupId: text("group_id").references(() => groups.id, {
    onDelete: "set null",
  }),
  contentKeyId: text("content_key_id").references(() => apiKeys.id, {
    onDelete: "set null",
  }),
  createdAt: integer("created_at").notNull().default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updated_at").notNull().default(sql`(unixepoch() * 1000)`),
  lastLoginAt: integer("last_login_at"),
});

export const sessions = sqliteTable("sessions", {
  token: text("token").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  ip: text("ip").notNull().default(""),
  userAgent: text("user_agent").notNull().default(""),
  createdAt: integer("created_at").notNull().default(sql`(unixepoch() * 1000)`),
  lastSeenAt: integer("last_seen_at")
    .notNull()
    .default(sql`(unixepoch() * 1000)`),
  expiresAt: integer("expires_at").notNull(),
});

export const passwordResetTokens = sqliteTable(
  "password_reset_tokens",
  {
    id: text("id").primaryKey(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    // sha256(token) hex. The plaintext token lives ONLY in the emailed link.
    tokenHash: text("token_hash").notNull(),
    expiresAt: integer("expires_at").notNull(),
    usedAt: integer("used_at"), // null until consumed (single-use)
    createdAt: integer("created_at").notNull().default(sql`(unixepoch() * 1000)`),
  },
  (t) => ({
    tokenHashIdx: index("idx_prt_token_hash").on(t.tokenHash),
    userIdIdx: index("idx_prt_user_id").on(t.userId),
  })
);

// Self-registration requests awaiting admin approval. Deliberately a separate
// table: every `users` row remains a real, sign-in-capable account, so no
// existing users query needs a "pending" filter. Approval moves the row into
// `users` in one transaction (see /api/admin/registrations/[id]/approve).
export const registrations = sqliteTable("registrations", {
  id: text("id").primaryKey(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  createdAt: integer("created_at").notNull().default(sql`(unixepoch() * 1000)`),
});

export const loginEvents = sqliteTable("login_events", {
  id: text("id").primaryKey(),
  userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
  emailAttempted: text("email_attempted").notNull(),
  success: integer("success").notNull(),
  ip: text("ip").notNull().default(""),
  userAgent: text("user_agent").notNull().default(""),
  createdAt: integer("created_at").notNull().default(sql`(unixepoch() * 1000)`),
});

// Assistant personas ("souls"). A soul IS a SOUL.md file — `soul` stores the
// verbatim file (optional frontmatter + persona body). Name / description /
// starters / mode / collection are parsed from the frontmatter at save time
// (src/lib/souls.ts) and cached in columns for listing without re-parsing.
export const assistants = sqliteTable("assistants", {
  id: text("id").primaryKey(),
  // Set only for repo-shipped souls (src/lib/builtin-souls.ts). Seeding
  // inserts missing keys only, so a "removed" (disabled) builtin is never
  // resurrected on restart — restore = re-enable the existing row.
  builtinKey: text("builtin_key").unique(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  soul: text("soul").notNull(),
  // JSON array of suggested questions (frontmatter `starters:`); shown on the
  // empty chat screen instead of the global starter prompts.
  starters: text("starters").notNull().default("[]"),
  // Advisory defaults applied client-side when a chat starts with this soul.
  mode: text("mode", { enum: ["chat", "deep-research"] }),
  collectionId: text("collection_id"),
  // builtin/global = visible to everyone; group = that group only;
  // user = personal to its creator.
  scope: text("scope", { enum: ["builtin", "global", "group", "user"] }).notNull(),
  groupId: text("group_id").references(() => groups.id, { onDelete: "cascade" }),
  userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
  enabled: integer("enabled").notNull().default(1),
  // Import provenance (soulweaver): source URL + recovered EIP-191 signer.
  sourceUrl: text("source_url"),
  verifiedSigner: text("verified_signer"),
  createdAt: integer("created_at").notNull().default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updated_at").notNull().default(sql`(unixepoch() * 1000)`),
});

// Team workspaces: a project groups chats and carries defaults (soul,
// collection scope, extra instructions) inherited by chats created inside it.
// Shared via project_shares; members see ALL chats in the project but can
// only continue/delete their own ("duplicate to continue" for the rest).
export const projects = sqliteTable("projects", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  name: text("name").notNull(),
  // Optional extra instructions, injected server-side per turn (after the
  // soul block) for every chat in the project. Never shown in the chat UI.
  instructions: text("instructions").notNull().default(""),
  assistantId: text("assistant_id").references(() => assistants.id, {
    onDelete: "set null",
  }),
  collectionId: text("collection_id"),
  createdAt: integer("created_at").notNull().default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updated_at").notNull().default(sql`(unixepoch() * 1000)`),
});

// One row per grant: either a whole group or a single user (exactly one of
// groupId/userId is set). Owner is implicitly a member.
export const projectShares = sqliteTable("project_shares", {
  id: text("id").primaryKey(),
  projectId: text("project_id")
    .notNull()
    .references(() => projects.id, { onDelete: "cascade" }),
  groupId: text("group_id").references(() => groups.id, { onDelete: "cascade" }),
  userId: text("user_id").references(() => users.id, { onDelete: "cascade" }),
  createdAt: integer("created_at").notNull().default(sql`(unixepoch() * 1000)`),
});

export const chatSessions = sqliteTable("chat_sessions", {
  id: text("id").primaryKey(),
  userId: text("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  title: text("title").notNull().default(""),
  // Opaque conversation_memory blob (JSON string) replayed to the backend on
  // each turn. Nullable — null/absent means "no memory yet" (turn 1 behavior).
  memory: text("memory"),
  // Pinned chats sort above the time-grouped list in the sidebar. Toggling
  // pinned deliberately does NOT bump updatedAt (would reorder the list).
  pinned: integer("pinned").notNull().default(0),
  // Soul this chat was started with (null = plain Cortex). The client sends
  // assistant_id on every /api/ask/stream turn; this column makes the choice
  // survive reload/device-switch.
  assistantId: text("assistant_id").references(() => assistants.id, {
    onDelete: "set null",
  }),
  // Project this chat lives in (null = personal flat list). Deleting a
  // project keeps the chats — they fall back to their authors' flat lists.
  projectId: text("project_id").references(() => projects.id, {
    onDelete: "set null",
  }),
  createdAt: integer("created_at").notNull().default(sql`(unixepoch() * 1000)`),
  updatedAt: integer("updated_at").notNull().default(sql`(unixepoch() * 1000)`),
});

export const chatMessages = sqliteTable("chat_messages", {
  id: text("id").primaryKey(),
  chatSessionId: text("chat_session_id")
    .notNull()
    .references(() => chatSessions.id, { onDelete: "cascade" }),
  role: text("role", { enum: ["user", "assistant"] }).notNull(),
  content: text("content").notNull(),
  // JSON-encoded: { sources, graphContext, thinking, subQuestions, retrieval, retrievalStats }
  metadata: text("metadata").notNull().default("{}"),
  createdAt: integer("created_at").notNull().default(sql`(unixepoch() * 1000)`),
});

export const usageEvents = sqliteTable("usage_events", {
  id: text("id").primaryKey(),
  userId: text("user_id").references(() => users.id, { onDelete: "set null" }),
  // "feedback" rows carry {sessionId, messageId, rating: "up"|"down"} in
  // metadata — written by POST /api/me/feedback, surfaced in admin analytics.
  kind: text("kind", { enum: ["message", "upload", "login", "feedback"] }).notNull(),
  collectionId: text("collection_id"),
  // JSON-encoded payload (e.g. filename, token counts, mode).
  metadata: text("metadata").notNull().default("{}"),
  createdAt: integer("created_at").notNull().default(sql`(unixepoch() * 1000)`),
});

// Superadmin-editable runtime settings (title, description, etc.). Key-value
// to keep future additions schema-free. Defaults live in src/lib/settings.ts.
export const appSettings = sqliteTable("app_settings", {
  key: text("key").primaryKey(),
  value: text("value").notNull(),
  updatedAt: integer("updated_at").notNull().default(sql`(unixepoch() * 1000)`),
});

export type User = typeof users.$inferSelect;
export type Group = typeof groups.$inferSelect;
export type ApiKey = typeof apiKeys.$inferSelect;
export type Session = typeof sessions.$inferSelect;
export type PasswordResetToken = typeof passwordResetTokens.$inferSelect;
export type Registration = typeof registrations.$inferSelect;
export type LoginEvent = typeof loginEvents.$inferSelect;
export type Assistant = typeof assistants.$inferSelect;
export type Project = typeof projects.$inferSelect;
export type ProjectShare = typeof projectShares.$inferSelect;
export type ChatSessionRow = typeof chatSessions.$inferSelect;
export type ChatMessageRow = typeof chatMessages.$inferSelect;
export type UsageEvent = typeof usageEvents.$inferSelect;
