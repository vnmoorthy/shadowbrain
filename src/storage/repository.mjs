// Repository — full v0.5 surface over the expanded sb_v01_entries table.
//
// Ships alongside the slim v0.1 repository. Both read/write the same table;
// v0.5 uses all columns, v0.1 uses the original 7. Parameterized queries
// throughout (the autoplan Eng review found three SQL-injection sites in
// the deferred draft of this file — fixed here).
//
// Trust check, secret/PII scan, adversarial flagging happen in the MCP tool
// layer, not here. The repository is the storage boundary; policy is one
// layer up.

import { uuidv7, entryContentHash, newEntry, nextLamport, setLamport } from '../schema/entry.mjs';
import { migrateToTarget } from './migrations.mjs';
import { openPgliteBackend } from './pglite.mjs';
import { log } from '../log.mjs';

const TOMBSTONE_DAYS = 30;

export async function openRepo(opts = {}) {
  const db = await openPgliteBackend(opts);
  const result = await migrateToTarget(db);
  if (result.applied.length > 0) {
    log.debug('migrations applied', { from: result.from, to: result.to, applied: result.applied });
  }
  // Hydrate Lamport from db so timestamps stay monotonic across restarts.
  try {
    const row = await db.queryOne(`SELECT MAX(lamport) AS l FROM sb_v01_entries`);
    if (row?.l != null) setLamport(Number(row.l));
  } catch {}
  return new Repository(db);
}

export class Repository {
  /**
   * Open a Repository — calls openRepo() under the hood. Provided for the
   * Repository.open(...) ergonomic that the restored CLI commands expect.
   */
  static async open(opts = {}) {
    return await openRepo(opts);
  }

  constructor(db) {
    this.db = db;
  }

  async close() { await this.db.close(); }

  // ── reads ──────────────────────────────────────────────────────────

  async get(id) {
    const row = await this.db.queryOne(
      `SELECT * FROM sb_v01_entries WHERE id = $1 AND deleted = FALSE`,
      [id]
    );
    return row ? rowToEntry(row) : null;
  }

  async list(f = {}) {
    const where = [];
    const params = [];
    if (!f.includeDeleted) where.push(`deleted = FALSE`);
    if (f.repo)  { params.push(f.repo);  where.push(`repo = $${params.length}`); }
    if (f.scope !== undefined && f.scope !== null) {
      params.push(f.scope); where.push(`scope = $${params.length}`);
    }
    if (f.topic) { params.push(f.topic); where.push(`topic = $${params.length}`); }
    if (f.kind)  { params.push(f.kind);  where.push(`kind = $${params.length}`); }
    if (f.since) { params.push(f.since); where.push(`last_modified_at >= $${params.length}`); }
    let sql = `SELECT * FROM sb_v01_entries`;
    if (where.length) sql += ` WHERE ${where.join(' AND ')}`;
    sql += ` ORDER BY last_modified_at DESC`;
    if (f.limit) {
      params.push(Number.parseInt(f.limit, 10));
      sql += ` LIMIT $${params.length}`;
    }
    if (f.offset) {
      params.push(Number.parseInt(f.offset, 10));
      sql += ` OFFSET $${params.length}`;
    }
    const rows = await this.db.query(sql, params);
    return rows.map(rowToEntry);
  }

  async count(f = {}) {
    const where = [];
    const params = [];
    if (!f.includeDeleted) where.push(`deleted = FALSE`);
    if (f.repo) { params.push(f.repo); where.push(`repo = $${params.length}`); }
    let sql = `SELECT COUNT(*)::int AS c FROM sb_v01_entries`;
    if (where.length) sql += ` WHERE ${where.join(' AND ')}`;
    const row = await this.db.queryOne(sql, params);
    return row?.c ?? 0;
  }

  async listRepos() {
    const rows = await this.db.query(
      `SELECT repo AS canonical_url, COUNT(*)::int AS entry_count
       FROM sb_v01_entries WHERE deleted = FALSE GROUP BY repo ORDER BY entry_count DESC`
    );
    return rows;
  }

  // ── writes ─────────────────────────────────────────────────────────

  /**
   * Insert or update. Idempotent by content_hash within (repo, scope, topic, kind).
   * @param {object} input - Entry fields. newEntry() fills defaults.
   * @param {object} [opts]
   * @param {boolean} [opts.fromSync] - When true, preserve incoming lamport AND
   *   last_modified_at instead of restamping with the local clock. Used by
   *   pullMirror, conflict resolution, and import — peer-originated writes
   *   carry the peer's Lamport state and our merge logic depends on it.
   * @returns {Promise<object>} the persisted entry.
   */
  async put(input, opts = {}) {
    const fromSync = opts.fromSync === true;
    let entry = newEntry(input);
    const hash = entryContentHash(entry);

    // Idempotency: same content under the same coordinates → no duplicate.
    const existing = await this.db.queryOne(
      `SELECT id, lamport FROM sb_v01_entries
       WHERE content_hash = $1 AND repo = $2 AND COALESCE(scope, '') = COALESCE($3, '')
         AND topic = $4 AND kind = $5 AND deleted = FALSE`,
      [hash, entry.repo, entry.scope, entry.topic, entry.kind]
    );
    if (existing) {
      // Idempotent hit. For fresh writes (not sync), bump last_modified_at to
      // 'now' so observers see the touch. For sync writes, only update if the
      // incoming entry has a higher lamport — peers should converge upward,
      // never silently regress to a local clock.
      //
      // Peer convergence note (codex finding #3): two peers writing identical
      // content under the same coordinates produce different ids. Each peer's
      // row keeps its own id; only `lamport` converges. The "loser" peer's
      // .json file lives on in the sync git repo as a phantom, but the
      // idempotency check turns subsequent pulls into no-ops once both peers
      // have stabilized. See test/integration/peer-convergence.test.mjs.
      if (fromSync) {
        const incomingLamport = Number(entry.lamport ?? 0);
        const existingLamport = Number(existing.lamport ?? 0);
        if (incomingLamport > existingLamport) {
          await this.db.query(
            `UPDATE sb_v01_entries SET lamport = $1, last_modified_at = $2 WHERE id = $3`,
            [String(incomingLamport), entry.last_modified_at, existing.id]
          );
        }
      } else {
        const now = new Date().toISOString();
        await this.db.query(
          `UPDATE sb_v01_entries SET last_modified_at = $1 WHERE id = $2`,
          [now, existing.id]
        );
      }
      return await this.get(existing.id);
    }

    if (!fromSync) {
      entry.lamport = nextLamport();
      entry.last_modified_at = new Date().toISOString();
    } else {
      // Hydrate the local Lamport monotonic counter so subsequent local writes
      // sort after this peer-originated entry.
      setLamport(Number(entry.lamport ?? 0));
    }

    await this.db.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO sb_v01_entries
           (id, repo, scope, topic, kind, title, body, text,
            ctx_files, ctx_symbols, ctx_deps, tags,
            confidence, author_agent, author_user, author_machine,
            created_at, last_modified_at, last_used_at, use_count,
            supersedes, superseded_by, warnings, content_hash, lamport, deleted, tombstone_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8,
                 $9::jsonb, $10::jsonb, $11::jsonb, $12::jsonb,
                 $13, $14, $15, $16,
                 $17, $18, $19, $20,
                 $21::jsonb, $22, $23::jsonb, $24, $25, $26, $27)
         ON CONFLICT (id) DO UPDATE SET
           repo = EXCLUDED.repo, scope = EXCLUDED.scope, topic = EXCLUDED.topic,
           kind = EXCLUDED.kind, title = EXCLUDED.title, body = EXCLUDED.body, text = EXCLUDED.text,
           ctx_files = EXCLUDED.ctx_files, ctx_symbols = EXCLUDED.ctx_symbols,
           ctx_deps = EXCLUDED.ctx_deps, tags = EXCLUDED.tags,
           confidence = EXCLUDED.confidence,
           last_modified_at = EXCLUDED.last_modified_at, last_used_at = EXCLUDED.last_used_at,
           use_count = EXCLUDED.use_count, supersedes = EXCLUDED.supersedes,
           superseded_by = EXCLUDED.superseded_by, warnings = EXCLUDED.warnings,
           content_hash = EXCLUDED.content_hash, lamport = EXCLUDED.lamport,
           deleted = EXCLUDED.deleted, tombstone_at = EXCLUDED.tombstone_at`,
        [
          entry.id, entry.repo, entry.scope, entry.topic, entry.kind,
          entry.title, entry.body, entry.body, // text mirrors body for v0.1 compat
          JSON.stringify(entry.context.files), JSON.stringify(entry.context.symbols),
          JSON.stringify(entry.context.deps), JSON.stringify(entry.context.tags),
          entry.confidence, entry.author.agent, entry.author.user, entry.author.machine,
          entry.created_at, entry.last_modified_at, entry.last_used_at, entry.use_count,
          JSON.stringify(entry.supersedes), entry.superseded_by, JSON.stringify(entry.warnings),
          hash, String(entry.lamport), entry.deleted, null,
        ]
      );
      await tx.query(
        `INSERT INTO sb_audit_log (entry_id, op, who_agent, who_user, who_machine, delta)
         VALUES ($1, 'put', $2, $3, $4, $5::jsonb)`,
        [
          entry.id, entry.author.agent, entry.author.user, entry.author.machine,
          JSON.stringify({ title: entry.title, kind: entry.kind, topic: entry.topic }),
        ]
      );
    });
    return entry;
  }

  /**
   * Soft-delete with tombstone. Auto-prune at TOMBSTONE_DAYS.
   */
  async forget(id, opts = {}) {
    const ts = new Date().toISOString();
    const lamport = nextLamport();
    await this.db.transaction(async (tx) => {
      await tx.query(
        `UPDATE sb_v01_entries
         SET deleted = TRUE, tombstone_at = $1, last_modified_at = $1, lamport = $2
         WHERE id = $3`,
        [ts, String(lamport), id]
      );
      await tx.query(
        `INSERT INTO sb_audit_log (entry_id, op, who_agent, who_user, who_machine, delta)
         VALUES ($1, 'forget', $2, $3, $4, $5::jsonb)`,
        [
          id, opts.author?.agent || 'unknown', opts.author?.user || 'unknown',
          opts.author?.machine || 'unknown',
          JSON.stringify({ reason: opts.reason || null }),
        ]
      );
    });
    return { id, deleted: true, tombstone_at: ts };
  }

  /**
   * Hard-delete tombstones older than TOMBSTONE_DAYS.
   */
  async pruneTombstones(now = Date.now()) {
    const cutoff = new Date(now - TOMBSTONE_DAYS * 86400_000).toISOString();
    const res = await this.db.query(
      `DELETE FROM sb_v01_entries WHERE deleted = TRUE AND tombstone_at < $1 RETURNING id`,
      [cutoff]
    );
    return res.length || 0;
  }

  async markUsed(id) {
    await this.db.query(
      `UPDATE sb_v01_entries SET last_used_at = NOW(), use_count = use_count + 1 WHERE id = $1`,
      [id]
    );
  }

  async markUsedBatch(ids) {
    if (!ids || ids.length === 0) return;
    await this.db.query(
      `UPDATE sb_v01_entries SET last_used_at = NOW(), use_count = use_count + 1 WHERE id = ANY($1::text[])`,
      [ids]
    );
  }

  async applyConfidence(deltas) {
    if (!deltas || deltas.length === 0) return;
    await this.db.transaction(async (tx) => {
      for (const d of deltas) {
        await tx.query(
          `UPDATE sb_v01_entries SET confidence = $1 WHERE id = $2`,
          [d.newConfidence, d.id]
        );
      }
    });
  }

  async prune(threshold) {
    const ts = new Date().toISOString();
    const lamport = nextLamport();
    const res = await this.db.query(
      `UPDATE sb_v01_entries SET deleted = TRUE, tombstone_at = $1, lamport = $2
       WHERE deleted = FALSE AND confidence < $3 RETURNING id`,
      [ts, String(lamport), threshold]
    );
    return res.length || 0;
  }

  async renameRepo(from, to) {
    const res = await this.db.query(
      `UPDATE sb_v01_entries SET repo = $1, last_modified_at = NOW(), lamport = lamport + 1
       WHERE repo = $2 RETURNING id`,
      [to, from]
    );
    return res.length || 0;
  }

  // ── search support (used by retrieval/ranker.mjs) ──────────────────

  async candidatesBM25({ query, repo, scope, kind, limit = 50 }) {
    // Always score in-process. Postgres tsvector + PGLite tsvector use
    // different stemmers (PGLite drops trailing "s" inconsistently — e.g.
    // "JWTs" stems to "jwts", which doesn't match a document containing
    // "JWT"). Skipping SQL-side full-text gives predictable retrieval
    // across both backends and lets us tune BM25 parameters in one place.
    // For huge corpora (>50k entries per repo) we can re-introduce a
    // SQL-side first-pass filter, but v0.5 is pre-product.
    const where = ['deleted = FALSE'];
    const params = [];
    if (repo) { params.push(repo); where.push(`repo = $${params.length}`); }
    if (scope !== undefined && scope !== null) { params.push(scope); where.push(`scope = $${params.length}`); }
    if (kind) { params.push(kind); where.push(`kind = $${params.length}`); }
    const rows = await this.db.query(
      `SELECT * FROM sb_v01_entries
       WHERE ${where.join(' AND ')}
       ORDER BY last_modified_at DESC
       LIMIT ${Math.max(500, Number.parseInt(limit, 10) * 10)}`,
      params
    );
    const { buildIndex, score } = await import('../retrieval/bm25.mjs');
    // Index over title (boosted) + body + topic + tags. Title repetition
    // gives titles roughly 3x the weight of body — matches user intuition
    // (a "JWT verify" titled entry is more relevant than a passing JWT
    // mention in body prose).
    const docs = rows.map((r, i) => ({
      id: i,
      text: `${r.title || ''} ${r.title || ''} ${r.title || ''} ${r.body || r.text || ''} ${r.topic || ''} ${(jsonOrArrayInline(r.tags) || []).join(' ')}`,
    }));
    const idx = buildIndex(docs);
    const scores = score(idx, query);
    return rows
      .map((r, i) => ({ entry: rowToEntry(r), bm25: scores[i] }))
      .filter((x) => x.bm25 > 0)
      .sort((a, b) => b.bm25 - a.bm25)
      .slice(0, Number.parseInt(limit, 10));
  }

  async candidatesDense({ embedding, repo, scope, kind, limit = 50 }) {
    if (!embedding || embedding.length === 0) return [];
    const where = ['deleted = FALSE', 'embedding_v1 IS NOT NULL'];
    const params = [];
    if (repo) { params.push(repo); where.push(`repo = $${params.length}`); }
    if (scope !== undefined && scope !== null) { params.push(scope); where.push(`scope = $${params.length}`); }
    if (kind) { params.push(kind); where.push(`kind = $${params.length}`); }
    const rows = await this.db.query(
      `SELECT * FROM sb_v01_entries WHERE ${where.join(' AND ')}`,
      params
    );
    const scored = rows.map((r) => {
      const v = parseEmbeddingFromRow(r.embedding_v1);
      const sim = v ? cosine(embedding, v) : 0;
      return { entry: rowToEntry(r), sim };
    });
    scored.sort((a, b) => b.sim - a.sim);
    return scored.slice(0, limit);
  }

  async writeEmbedding(id, embedding) {
    if (!embedding || !Array.isArray(embedding)) return;
    const buf = Buffer.from(new Float32Array(embedding).buffer);
    await this.db.query(`UPDATE sb_v01_entries SET embedding_v1 = $1 WHERE id = $2`, [buf, id]);
  }
}

// ─── helpers ────────────────────────────────────────────────────────

export function rowToEntry(r) {
  if (!r) return null;
  return {
    id: r.id,
    repo: r.repo,
    scope: r.scope ?? null,
    topic: r.topic ?? '',
    kind: r.kind,
    title: r.title ?? '',
    body: r.body ?? r.text ?? '',
    text: r.text ?? '',
    context: {
      files: jsonOrArray(r.ctx_files),
      symbols: jsonOrArray(r.ctx_symbols),
      deps: jsonOrArray(r.ctx_deps),
      tags: jsonOrArray(r.tags),
    },
    confidence: Number(r.confidence ?? 0.7),
    author: { agent: r.author_agent ?? 'unknown', user: r.author_user ?? 'unknown', machine: r.author_machine ?? 'unknown' },
    created_at: toIso(r.created_at),
    last_modified_at: toIso(r.last_modified_at ?? r.created_at),
    last_used_at: r.last_used_at ? toIso(r.last_used_at) : null,
    use_count: Number(r.use_count ?? 0),
    supersedes: jsonOrArray(r.supersedes),
    superseded_by: r.superseded_by ?? null,
    warnings: jsonOrArray(r.warnings),
    embedding_v1: parseEmbeddingFromRow(r.embedding_v1),
    embedding_v2: null,
    lamport: Number(r.lamport ?? 0),
    deleted: !!r.deleted,
  };
}

// Inline alias for use inside class methods that can't see the closure-scoped
// helper before the file finishes loading.
function jsonOrArrayInline(v) { return jsonOrArray(v); }

function jsonOrArray(v) {
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

function parseEmbeddingFromRow(v) {
  if (v == null) return null;
  if (Array.isArray(v)) return v;
  if (Buffer.isBuffer(v)) {
    const arr = new Float32Array(v.buffer, v.byteOffset, v.byteLength / 4);
    return Array.from(arr);
  }
  if (typeof v === 'string' && v.startsWith('[')) {
    try { return JSON.parse(v); } catch { return null; }
  }
  return null;
}

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) { dot += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}
