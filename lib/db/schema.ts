import { sql } from "drizzle-orm";
import {
  pgTable,
  uuid,
  text,
  timestamp,
  pgRole,
  index,
  uniqueIndex,
  check,
  jsonb,
  bigserial,
  inet,
} from "drizzle-orm/pg-core";

/* ---- tenants ---- */
export const clients = pgTable("clients", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  brandColor: text("brand_color"),
  logoUrl: text("logo_url"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/* ---- platform admins ---- */
export const admins = pgTable("admins", {
  id: uuid("id")
    .primaryKey()
    .default(sql`gen_random_uuid()`),
  email: text("email").notNull().unique(),
  name: text("name"),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
});

/* ---- users within a tenant ---- */
export const clientMembers = pgTable(
  "client_members",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    name: text("name"),
    role: text("role").notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    uniqTenantEmail: uniqueIndex("client_members_tenant_email_idx").on(t.clientId, t.email),
    roleCheck: check("client_members_role_check", sql`${t.role} IN ('viewer','admin_of_client')`),
  }),
);

/* ---- edicts ---- */
export const docs = pgTable(
  "docs",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    slug: text("slug").notNull().unique(),
    title: text("title").notNull(),
    bodyType: text("body_type").notNull(),
    body: text("body").notNull(),
    createdBy: uuid("created_by")
      .notNull()
      .references(() => admins.id),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    bodyTypeCheck: check("docs_body_type_check", sql`${t.bodyType} IN ('html','markdown')`),
  }),
);

/* ---- many-to-many: tenant ↔ doc ---- */
export const docShares = pgTable(
  "doc_shares",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    docId: uuid("doc_id")
      .notNull()
      .references(() => docs.id, { onDelete: "cascade" }),
    clientId: uuid("client_id")
      .notNull()
      .references(() => clients.id, { onDelete: "cascade" }),
    sharedAt: timestamp("shared_at", { withTimezone: true }).defaultNow().notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => ({
    uniqDocClient: uniqueIndex("doc_shares_doc_client_idx").on(t.docId, t.clientId),
    clientRevokedIdx: index("doc_shares_client_revoked_idx").on(t.clientId, t.revokedAt),
  }),
);

/* ---- pending magic-link tokens; raw only in email ---- */
export const magicLinkTokens = pgTable(
  "magic_link_tokens",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    tokenHash: text("token_hash").notNull().unique(),
    subjectType: text("subject_type").notNull(),
    subjectId: uuid("subject_id").notNull(),
    email: text("email").notNull(),
    clientId: uuid("client_id").references(() => clients.id),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    consumedAt: timestamp("consumed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    subjectTypeCheck: check(
      "magic_link_subject_type_check",
      sql`${t.subjectType} IN ('client_member','admin')`,
    ),
    expiresIdx: index("magic_link_expires_idx").on(t.expiresAt),
  }),
);

/* ---- active sessions; raw only in cookie ---- */
export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`gen_random_uuid()`),
    sessionTokenHash: text("session_token_hash").notNull().unique(),
    subjectType: text("subject_type").notNull(),
    subjectId: uuid("subject_id").notNull(),
    clientId: uuid("client_id").references(() => clients.id),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    ip: inet("ip"),
    userAgent: text("user_agent"),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).defaultNow().notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => ({
    subjectTypeCheck: check(
      "sessions_subject_type_check",
      sql`${t.subjectType} IN ('client_member','admin')`,
    ),
    adminNullClient: check(
      "sessions_admin_null_client",
      sql`(${t.subjectType} = 'admin' AND ${t.clientId} IS NULL)
      OR (${t.subjectType} = 'client_member' AND ${t.clientId} IS NOT NULL)`,
    ),
    subjectRevokedIdx: index("sessions_subject_revoked_idx").on(t.subjectId, t.revokedAt),
  }),
);
