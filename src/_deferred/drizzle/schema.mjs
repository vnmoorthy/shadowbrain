// Schema definitions for the storage tables. We keep them in raw SQL strings
// rather than drizzle's TypeScript builders for two reasons: (1) PGLite and
// Postgres support slightly different DDL flavors that we paper over here,
// (2) we avoid pulling drizzle-orm's runtime into the hot path. The schema
// is small enough that the redundancy is worth the simplicity.

import { ENTRY_KINDS } from '../../schema/kinds.mjs';

const KINDS_LITERAL = ENTRY_KINDS.map((k) => `'${k}'`).join(', ');

// Note: PGLite ships pgvector since 0.2.x, but the extension must be loaded
// per database. We try and fall back to BYTEA storage with a JS-side cosine
// similarity if pgvector is unavailable.
export const SQL_CREATE = {
  entries: (hasVector) => `
    CREATE TABLE IF NOT EXISTS sb_entries (
      id              TEXT PRIMARY KEY,
      repo            TEXT NOT NULL,
      scope           TEXT,
      topic           TEXT NOT NULL,
      kind            TEXT NOT NULL CHECK (kind IN (${KINDS_LITERAL})),
      title           TEXT NOT NULL,
      body            TEXT NOT NULL,
      ctx_files       JSONB NOT NULL DEFAULT '[]'::jsonb,
      ctx_symbols     JSONB NOT NULL DEFAULT '[]'::jsonb,
      ctx_deps        JSONB NOT NULL DEFAULT '[]'::jsonb,
      ctx_tags        JSONB NOT NULL DEFAULT '[]'::jsonb,
      confidence      REAL NOT NULL DEFAULT 0.7,
      author_agent    TEXT NOT NULL DEFAULT 'unknown',
      author_user     TEXT NOT NULL DEFAULT 'unknown',
      author_machine  TEXT NOT NULL DEFAULT 'unknown',
      created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_modified_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_used_at    TIMESTAMPTZ,
      use_count       INTEGER NOT NULL DEFAULT 0,
      supersedes      JSONB NOT NULL DEFAULT '[]'::jsonb,
      superseded_by   TEXT,
      warnings        JSONB NOT NULL DEFAULT '[]'::jsonb,
      content_hash    TEXT NOT NULL,
      lamport         BIGINT NOT NULL DEFAULT 0,
      deleted         BOOLEAN NOT NULL DEFAULT FALSE,
      tombstone_at    TIMESTAMPTZ,
      ${hasVector ? 'embedding_v1   vector(384),' : 'embedding_v1   BYTEA,'}
      ${hasVector ? 'embedding_v2   vector(768),' : 'embedding_v2   BYTEA,'}
      ts_search       TEXT
    );`,

  // Covering index from the spec's hot read path. The ranker filters by
  // (repo, scope, topic, kind) and orders by last_used_at desc.
  idx_repo_scope_topic_kind: () => `
    CREATE INDEX IF NOT EXISTS idx_entries_repo_scope_topic_kind_used
    ON sb_entries (repo, scope, topic, kind, last_used_at DESC);`,

  idx_content_hash: () => `
    CREATE INDEX IF NOT EXISTS idx_entries_content_hash
    ON sb_entries (content_hash);`,

  idx_lamport: () => `
    CREATE INDEX IF NOT EXISTS idx_entries_lamport
    ON sb_entries (lamport DESC);`,

  // pgvector index. Only created if vector type was available.
  idx_embedding_v1: () => `
    CREATE INDEX IF NOT EXISTS idx_entries_embedding_v1
    ON sb_entries USING hnsw (embedding_v1 vector_cosine_ops);`,

  idx_tombstone: () => `
    CREATE INDEX IF NOT EXISTS idx_entries_tombstone
    ON sb_entries (tombstone_at) WHERE deleted = TRUE;`,

  // tsvector full-text. We materialize on write rather than as a generated
  // column to keep PGLite + Postgres parity.
  idx_text_search: () => `
    CREATE INDEX IF NOT EXISTS idx_entries_text_search
    ON sb_entries USING gin (to_tsvector('english', coalesce(title,'') || ' ' || coalesce(body,'')));`,

  meta: () => `
    CREATE TABLE IF NOT EXISTS sb_meta (
      key   TEXT PRIMARY KEY,
      value JSONB
    );`,

  conflicts: () => `
    CREATE TABLE IF NOT EXISTS sb_conflicts (
      id            TEXT PRIMARY KEY,
      entry_id      TEXT NOT NULL,
      mine          JSONB NOT NULL,
      theirs        JSONB NOT NULL,
      merged        JSONB,
      detected_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      resolution    TEXT
    );`,

  audit_log: () => `
    CREATE TABLE IF NOT EXISTS sb_audit_log (
      id            BIGSERIAL PRIMARY KEY,
      entry_id      TEXT NOT NULL,
      op            TEXT NOT NULL,
      who_agent     TEXT,
      who_user      TEXT,
      who_machine   TEXT,
      at            TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      delta         JSONB
    );`,
};

/**
 * Run all schema-create statements for a backend.
 * @param {object} db - opaque backend handle exposing { exec(sql) }.
 * @param {boolean} hasVector - whether pgvector is loaded.
 */
export async function ensureSchema(db, hasVector) {
  await db.exec(SQL_CREATE.entries(hasVector));
  await db.exec(SQL_CREATE.idx_repo_scope_topic_kind());
  await db.exec(SQL_CREATE.idx_content_hash());
  await db.exec(SQL_CREATE.idx_lamport());
  await db.exec(SQL_CREATE.idx_tombstone());
  if (hasVector) {
    try {
      await db.exec(SQL_CREATE.idx_embedding_v1());
    } catch (err) {
      // hnsw may not be available on older pgvector; fall back silently.
      // Cosine similarity still works without the index, just slower.
    }
  }
  try {
    await db.exec(SQL_CREATE.idx_text_search());
  } catch (err) {
    // PGLite older than 0.2 lacks tsvector. Search falls back to LIKE.
  }
  await db.exec(SQL_CREATE.meta());
  await db.exec(SQL_CREATE.conflicts());
  await db.exec(SQL_CREATE.audit_log());
}
