// Repository (v0.1) — slim CRUD over PGLite.
//
// 7 columns, 2 ops (put, search), parameterized queries only. No PII scans,
// no secrets scanner, no lamport timestamps, no audit log, no embeddings,
// no tombstones. The full machinery lives in src/_deferred/repository-v05.mjs
// and ships when v0.5 sync arrives.
//
// Schema is owned by this module — it runs `ensureSchema` on open. The
// `meta` table tracks `schema_version` so a future bump can refuse stale DBs.

import { uuidv7 } from '../schema/entry.mjs';
import { openPgliteBackend } from './pglite.mjs';
import { SchemaMismatchError } from '../cli/errors.mjs';

export const SCHEMA_VERSION_V01 = 1;
export const KIND_DEFAULT = 'gotcha';

/**
 * Open a v0.1 repository. Returns a handle with `.put`, `.search`, `.list`,
 * `.count`, `.close`. All queries are parameterized.
 *
 * @param {{ dbPath?: string, ephemeral?: boolean }} opts
 */
export async function openRepoV01(opts = {}) {
  const db = await openPgliteBackend(opts);
  await ensureSchemaV01(db);
  return new RepositoryV01(db);
}

async function ensureSchemaV01(db) {
  await db.exec(`
    CREATE TABLE IF NOT EXISTS sb_meta (
      key   TEXT PRIMARY KEY,
      value JSONB
    );
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

  const row = await db.queryOne(
    `SELECT value FROM sb_meta WHERE key = 'schema_version_v01'`
  );
  const found = row?.value ? Number(JSON.parse(typeof row.value === 'string' ? row.value : JSON.stringify(row.value))) : null;
  if (found == null) {
    await db.query(
      `INSERT INTO sb_meta (key, value) VALUES ('schema_version_v01', $1::jsonb) ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
      [JSON.stringify(SCHEMA_VERSION_V01)]
    );
  } else if (found !== SCHEMA_VERSION_V01) {
    throw new SchemaMismatchError({ found, expected: SCHEMA_VERSION_V01 });
  }
}

class RepositoryV01 {
  constructor(db) {
    this.db = db;
  }

  async close() {
    await this.db.close();
  }

  /**
   * Insert an entry.
   * @param {{ text: string, kind?: string, repo: string, tags?: string[] }} input
   * @returns {Promise<{ id: string, created_at: string }>}
   */
  async put({ text, kind, repo, tags }) {
    if (!text || typeof text !== 'string') throw new Error('text is required');
    if (!repo || typeof repo !== 'string') throw new Error('repo is required');
    const id = uuidv7();
    const k = (typeof kind === 'string' && kind.length > 0) ? kind : KIND_DEFAULT;
    const t = Array.isArray(tags) ? tags.filter((x) => typeof x === 'string') : [];
    const row = await this.db.queryOne(
      `INSERT INTO sb_v01_entries (id, repo, kind, text, tags)
       VALUES ($1, $2, $3, $4, $5::jsonb)
       RETURNING id, created_at`,
      [id, repo, k, text, JSON.stringify(t)]
    );
    return { id: row.id, created_at: toIso(row.created_at) };
  }

  /**
   * Search entries by lexical match within a repo.
   * @param {{ query: string, repo: string, limit?: number }} input
   * @returns {Promise<{ engine: 'like'|'fts', results: Array<{id, text, kind, tags, created_at, score}> }>}
   */
  async search({ query, repo, limit }) {
    if (!query || typeof query !== 'string') throw new Error('query is required');
    if (!repo || typeof repo !== 'string') throw new Error('repo is required');
    const lim = Math.max(1, Math.min(50, Number.parseInt(limit, 10) || 5));
    // v0.1 uses LIKE only — honest, simple, predictable. tsvector lives in v0.5.
    const like = `%${query.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    const rows = await this.db.query(
      `SELECT id, text, kind, tags, created_at
       FROM sb_v01_entries
       WHERE repo = $1 AND text ILIKE $2
       ORDER BY created_at DESC
       LIMIT $3`,
      [repo, like, lim]
    );
    if (rows.length > 0) {
      await this.db.query(
        `UPDATE sb_v01_entries
         SET last_used_at = NOW()
         WHERE id = ANY($1::text[])`,
        [rows.map((r) => r.id)]
      );
    }
    return {
      engine: 'like',
      results: rows.map((r) => ({
        id: r.id,
        text: r.text,
        kind: r.kind,
        tags: parseJsonArray(r.tags),
        created_at: toIso(r.created_at),
        score: 0,
      })),
    };
  }

  async list({ repo, limit } = {}) {
    const lim = Math.max(1, Math.min(500, Number.parseInt(limit, 10) || 50));
    const rows = repo
      ? await this.db.query(
          `SELECT id, repo, kind, text, tags, created_at FROM sb_v01_entries WHERE repo = $1 ORDER BY created_at DESC LIMIT $2`,
          [repo, lim]
        )
      : await this.db.query(
          `SELECT id, repo, kind, text, tags, created_at FROM sb_v01_entries ORDER BY created_at DESC LIMIT $1`,
          [lim]
        );
    return rows.map((r) => ({
      id: r.id,
      repo: r.repo,
      kind: r.kind,
      text: r.text,
      tags: parseJsonArray(r.tags),
      created_at: toIso(r.created_at),
    }));
  }

  async count({ repo } = {}) {
    const row = repo
      ? await this.db.queryOne(`SELECT COUNT(*)::int AS c FROM sb_v01_entries WHERE repo = $1`, [repo])
      : await this.db.queryOne(`SELECT COUNT(*)::int AS c FROM sb_v01_entries`);
    return Number(row?.c ?? 0);
  }
}

function parseJsonArray(v) {
  if (Array.isArray(v)) return v;
  if (v == null) return [];
  if (typeof v === 'string') {
    try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch { return []; }
  }
  return [];
}

function toIso(v) {
  if (!v) return null;
  if (typeof v === 'string') return v;
  return new Date(v).toISOString();
}
