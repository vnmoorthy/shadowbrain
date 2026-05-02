// Forward-only schema migrations.
//
// v0.1 ships with sb_v01_entries (7 cols). v0.5 ALTERs it in place — adding
// the columns the deferred Repository / retrieval / sync layers need. PGLite
// supports ADD COLUMN with default values, so this is fast and safe.
//
// Each migration is idempotent: it checks pg_attribute to see if the column
// already exists before adding. We use this rather than a strict version
// number alone because users may sit on partially-migrated DBs (interrupted
// run, half-applied migration). Idempotent ALTERs let us recover.
//
// To add a new migration:
//   1. Bump TARGET_SCHEMA_VERSION below.
//   2. Append a step to MIGRATIONS that runs the additive DDL.
//   3. Update sb_meta key 'schema_version' to TARGET_SCHEMA_VERSION on success.

import { uuidv7 } from '../schema/entry.mjs';

export const TARGET_SCHEMA_VERSION = 5;

export async function migrateToTarget(db) {
  await ensureMetaTable(db);
  const current = await readVersion(db);
  if (current >= TARGET_SCHEMA_VERSION) return { from: current, to: current, applied: [] };

  const applied = [];
  for (const m of MIGRATIONS) {
    if (m.version <= current) continue;
    await m.run(db);
    await writeVersion(db, m.version);
    applied.push(m.version);
  }
  return { from: current, to: TARGET_SCHEMA_VERSION, applied };
}

async function ensureMetaTable(db) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS sb_meta (
      key   TEXT PRIMARY KEY,
      value JSONB
    );
  `);
}

async function readVersion(db) {
  const row = await db.queryOne(`SELECT value FROM sb_meta WHERE key = 'schema_version'`);
  if (!row?.value) return 0;
  try {
    const v = typeof row.value === 'string' ? JSON.parse(row.value) : row.value;
    return Number(v) || 0;
  } catch {
    return 0;
  }
}

async function writeVersion(db, v) {
  await db.query(
    `INSERT INTO sb_meta (key, value) VALUES ('schema_version', $1::jsonb)
     ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
    [JSON.stringify(v)]
  );
}

// ─── migration steps ────────────────────────────────────────────────

const MIGRATIONS = [
  {
    version: 1,
    async run(db) {
      // v0.1 baseline. The repository module also creates this; we mirror
      // it here so a DB initialised by the migrator alone is still valid.
      await db.exec(`
        CREATE TABLE IF NOT EXISTS sb_v01_entries (
          id           TEXT PRIMARY KEY,
          repo         TEXT NOT NULL,
          kind         TEXT NOT NULL DEFAULT 'gotcha',
          text         TEXT NOT NULL,
          tags         JSONB NOT NULL DEFAULT '[]'::jsonb,
          created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          last_used_at TIMESTAMPTZ
        );
        CREATE INDEX IF NOT EXISTS idx_v01_entries_repo ON sb_v01_entries (repo);
        CREATE INDEX IF NOT EXISTS idx_v01_entries_created ON sb_v01_entries (created_at DESC);
      `);
    },
  },
  {
    version: 2,
    async run(db) {
      // v0.5 column expansion — adds the rich entry shape on top of the v0.1
      // table. Existing rows pick up sensible defaults (scope null, topic
      // empty, body=text, etc).
      const cols = [
        ['scope',           "TEXT"],
        ['topic',           "TEXT NOT NULL DEFAULT ''"],
        ['title',           "TEXT NOT NULL DEFAULT ''"],
        ['body',            "TEXT NOT NULL DEFAULT ''"],
        ['ctx_files',       "JSONB NOT NULL DEFAULT '[]'::jsonb"],
        ['ctx_symbols',     "JSONB NOT NULL DEFAULT '[]'::jsonb"],
        ['ctx_deps',        "JSONB NOT NULL DEFAULT '[]'::jsonb"],
        ['confidence',      "REAL NOT NULL DEFAULT 0.7"],
        ['author_agent',    "TEXT NOT NULL DEFAULT 'unknown'"],
        ['author_user',     "TEXT NOT NULL DEFAULT 'unknown'"],
        ['author_machine',  "TEXT NOT NULL DEFAULT 'unknown'"],
        ['last_modified_at',"TIMESTAMPTZ NOT NULL DEFAULT NOW()"],
        ['use_count',       "INTEGER NOT NULL DEFAULT 0"],
        ['supersedes',      "JSONB NOT NULL DEFAULT '[]'::jsonb"],
        ['superseded_by',   "TEXT"],
        ['warnings',        "JSONB NOT NULL DEFAULT '[]'::jsonb"],
        ['content_hash',    "TEXT"],
        ['lamport',         "BIGINT NOT NULL DEFAULT 0"],
        ['deleted',         "BOOLEAN NOT NULL DEFAULT FALSE"],
        ['tombstone_at',    "TIMESTAMPTZ"],
        ['embedding_v1',    "BYTEA"],
      ];
      for (const [name, type] of cols) {
        await db.exec(`ALTER TABLE sb_v01_entries ADD COLUMN IF NOT EXISTS ${name} ${type};`);
      }
      await db.exec(`
        CREATE INDEX IF NOT EXISTS idx_entries_content_hash ON sb_v01_entries (content_hash);
        CREATE INDEX IF NOT EXISTS idx_entries_lamport ON sb_v01_entries (lamport DESC);
        CREATE INDEX IF NOT EXISTS idx_entries_repo_topic_kind ON sb_v01_entries (repo, topic, kind, last_used_at DESC);
        CREATE INDEX IF NOT EXISTS idx_entries_tombstone ON sb_v01_entries (tombstone_at) WHERE deleted = TRUE;
      `);
      // Backfill content_hash + lamport for any pre-existing v0.1 rows.
      const rows = await db.query(`SELECT id, repo, kind, text FROM sb_v01_entries WHERE content_hash IS NULL`);
      for (const r of rows) {
        const hash = quickHash([r.repo, r.kind, r.text].join('\x00'));
        const lamport = BigInt(Date.now()) * 1000n + BigInt(Math.floor(Math.random() * 1000));
        await db.query(
          `UPDATE sb_v01_entries SET content_hash = $1, lamport = $2, body = COALESCE(NULLIF(body, ''), text) WHERE id = $3`,
          [hash, lamport.toString(), r.id]
        );
      }
    },
  },
  {
    version: 3,
    async run(db) {
      // Conflict log + audit table.
      await db.exec(`
        CREATE TABLE IF NOT EXISTS sb_conflicts (
          id           TEXT PRIMARY KEY,
          entry_id     TEXT NOT NULL,
          mine         JSONB NOT NULL,
          theirs       JSONB NOT NULL,
          merged       JSONB,
          detected_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          resolution   JSONB
        );
        CREATE TABLE IF NOT EXISTS sb_audit_log (
          id           BIGSERIAL PRIMARY KEY,
          entry_id     TEXT NOT NULL,
          op           TEXT NOT NULL,
          who_agent    TEXT,
          who_user     TEXT,
          who_machine  TEXT,
          at           TIMESTAMPTZ NOT NULL DEFAULT NOW(),
          delta        JSONB
        );
      `);
    },
  },
  {
    version: 4,
    async run(db) {
      // Sync state: per-repo tracking of last-pushed/pulled lamport so the
      // git mirror can be incremental.
      await db.exec(`
        CREATE TABLE IF NOT EXISTS sb_sync_state (
          repo            TEXT PRIMARY KEY,
          last_push       BIGINT NOT NULL DEFAULT 0,
          last_pull       BIGINT NOT NULL DEFAULT 0,
          last_push_at    TIMESTAMPTZ,
          last_pull_at    TIMESTAMPTZ,
          remote_commit   TEXT
        );
      `);
    },
  },
  {
    version: 5,
    async run(db) {
      // No-op upgrade marker so a future column add can be appended cleanly
      // without renumbering. Reserve the slot.
      await db.exec(`SELECT 1`);
    },
  },
];

// Tiny non-cryptographic content hash used for backfill only. The real
// content hash lives in src/schema/entry.mjs and uses sha256.
function quickHash(s) {
  let h = 0n;
  for (let i = 0; i < s.length; i++) {
    h = (h * 1099511628211n + BigInt(s.charCodeAt(i))) & 0xffffffffffffffffn;
  }
  return h.toString(16).padStart(16, '0');
}

// Re-export for convenience.
export { uuidv7 };
