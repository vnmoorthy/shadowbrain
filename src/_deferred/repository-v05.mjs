// Repository — backend-agnostic CRUD + search over entries.
//
// All persistence flows through here. The MCP tools, CLI commands, and
// sync layer all use this single class, so backend differences don't leak
// out. Both pglite and postgres handles satisfy the same interface defined
// in src/storage/pglite.mjs / postgres.mjs.

import { entryContentHash, newEntry, nextLamport, setLamport } from '../schema/entry.mjs';
import { tryValidateEntry, MAX_BODY_TOKENS, approximateTokenCount } from '../schema/validators.mjs';
import { ENTRY_KINDS } from '../schema/kinds.mjs';
import { scanForSecrets } from '../ingest/secrets.mjs';
import { scanForPII } from '../ingest/pii.mjs';
import { detectAdversarial } from '../ingest/enricher.mjs';
import { openPgliteBackend } from './pglite.mjs';
import { openPostgresBackend } from './postgres.mjs';
import { log } from '../log.mjs';

const TOMBSTONE_DAYS = 30;

export class Repository {
  /**
   * Open a Repository using either pglite or postgres based on env / config.
   *   SHADOWBRAIN_BACKEND=postgres SHADOWBRAIN_PG_URL=<url>
   * Defaults to pglite at SHADOWBRAIN_HOME/db/.
   */
  static async open(opts = {}) {
    const backend = opts.backend ?? process.env.SHADOWBRAIN_BACKEND ?? 'pglite';
    let db;
    if (backend === 'postgres') {
      const url = opts.url ?? process.env.SHADOWBRAIN_PG_URL;
      if (!url) throw new Error('postgres backend requires SHADOWBRAIN_PG_URL or opts.url');
      db = await openPostgresBackend({ url });
    } else {
      db = await openPgliteBackend({ dbPath: opts.dbPath, ephemeral: opts.ephemeral });
    }
    // hydrate Lamport from db
    try {
      const row = await db.queryOne(`SELECT MAX(lamport) AS l FROM sb_entries`);
      if (row?.l != null) setLamport(Number(row.l));
    } catch {}
    return new Repository(db);
  }

  /** @param {object} db */
  constructor(db) {
    this.db = db;
  }

  async close() { await this.db.close(); }

  // ──────────────────────────────────────────────────────────────────
  // Reads
  // ──────────────────────────────────────────────────────────────────

  /**
   * Fetch one entry by id (returns null if not found or tombstoned).
   */
  async get(id) {
    const row = await this.db.queryOne(
      `SELECT * FROM sb_entries WHERE id = $1 AND deleted = FALSE`,
      [id]
    );
    return row ? rowToEntry(row) : null;
  }

  /**
   * List entries with optional filters.
   * @param {{ repo?: string, scope?: string, topic?: string, kind?: string, since?: string, limit?: number, offset?: number, includeDeleted?: boolean }} f
   */
  async list(f = {}) {
    const where = [];
    const params = [];
    if (!f.includeDeleted) where.push(`deleted = FALSE`);
    if (f.repo)  { params.push(f.repo);  where.push(`repo = $${params.length}`); }
    if (f.scope !== undefined && f.scope !== null) { params.push(f.scope); where.push(`scope = $${params.length}`); }
    if (f.topic) { params.push(f.topic); where.push(`topic = $${params.length}`); }
    if (f.kind)  { params.push(f.kind);  where.push(`kind = $${params.length}`); }
    if (f.since) { params.push(f.since); where.push(`last_modified_at >= $${params.length}`); }
    const sql = `
      SELECT * FROM sb_entries
      ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
      ORDER BY last_modified_at DESC
      ${f.limit ? `LIMIT ${Number.parseInt(f.limit, 10)}` : ''}
      ${f.offset ? `OFFSET ${Number.parseInt(f.offset, 10)}` : ''}
    `;
    const rows = await this.db.query(sql, params);
    return rows.map(rowToEntry);
  }

  /**
   * Count entries (non-deleted by default).
   */
  async count(f = {}) {
    const where = [];
    const params = [];
    if (!f.includeDeleted) where.push(`deleted = FALSE`);
    if (f.repo) { params.push(f.repo); where.push(`repo = $${params.length}`); }
    const row = await this.db.queryOne(
      `SELECT COUNT(*)::int AS c FROM sb_entries ${where.length ? 'WHERE ' + where.join(' AND ') : ''}`,
      params
    );
    return row?.c ?? 0;
  }

  /**
   * List repos with entry counts.
   */
  async listRepos() {
    const rows = await this.db.query(
      `SELECT repo AS canonical_url, COUNT(*)::int AS entry_count
       FROM sb_entries WHERE deleted = FALSE GROUP BY repo ORDER BY entry_count DESC`
    );
    return rows;
  }

  // ──────────────────────────────────────────────────────────────────
  // Writes
  // ──────────────────────────────────────────────────────────────────

  /**
   * Insert or update an entry (upsert by id, idempotent by content_hash).
   * @param {object} input - partial Entry. Missing fields are filled with defaults.
   * @param {{ skipScans?: boolean, fromImport?: boolean, merge?: boolean }} [opts]
   */
  async put(input, opts = {}) {
    let entry = newEntry(input);

    // Body size guard.
    const tokenCount = approximateTokenCount(entry.body);
    if (tokenCount > MAX_BODY_TOKENS) {
      const err = new Error(`entry body exceeds ${MAX_BODY_TOKENS}-token limit (was ~${tokenCount})`);
      err.code = 'BODY_TOO_LARGE';
      throw err;
    }

    // Defense-in-depth scans (skip on import / sync to avoid re-blocking
    // entries that already passed scans on the writing machine).
    if (!opts.skipScans) {
      const secrets = scanForSecrets(`${entry.title}\n${entry.body}`);
      if (secrets.length > 0) {
        const err = new Error(`refused: secret-shaped data detected: ${secrets.map((s) => s.kind).join(', ')}`);
        err.code = 'SECRET_DETECTED';
        err.findings = secrets;
        throw err;
      }
      const pii = scanForPII(`${entry.title}\n${entry.body}`, opts.piiPolicy);
      if (pii.length > 0 && pii.some((p) => p.severity === 'block')) {
        const err = new Error(`refused: PII detected: ${pii.map((p) => p.kind).join(', ')}`);
        err.code = 'PII_DETECTED';
        err.findings = pii;
        throw err;
      }
      const adv = detectAdversarial(entry);
      if (adv.length > 0) {
        entry.warnings = [...(entry.warnings || []), ...adv.map((a) => a.message)];
      }
    }

    const hash = entryContentHash(entry);

    // Idempotency: if a non-deleted entry with the same content_hash exists
    // for the same (repo, scope, topic, kind), update its last_modified_at
    // and return that. The agent can retry without producing duplicates.
    const existing = await this.db.queryOne(
      `SELECT id FROM sb_entries
       WHERE content_hash = $1 AND repo = $2 AND coalesce(scope, '') = coalesce($3, '')
         AND topic = $4 AND kind = $5 AND deleted = FALSE`,
      [hash, entry.repo, entry.scope, entry.topic, entry.kind]
    );

    if (existing && !opts.merge) {
      const now = new Date().toISOString();
      await this.db.query(
        `UPDATE sb_entries SET last_modified_at = $1 WHERE id = $2`,
        [now, existing.id]
      );
      return await this.get(existing.id);
    }

    entry.lamport = nextLamport();
    entry = { ...entry, last_modified_at: new Date().toISOString() };

    await this.db.transaction(async (tx) => {
      const cols = [
        'id','repo','scope','topic','kind','title','body',
        'ctx_files','ctx_symbols','ctx_deps','ctx_tags',
        'confidence','author_agent','author_user','author_machine',
        'created_at','last_modified_at','last_used_at','use_count',
        'supersedes','superseded_by','warnings','content_hash','lamport','deleted','tombstone_at',
        'embedding_v1','embedding_v2',
      ];
      const placeholders = cols.map((_, i) => `$${i + 1}`).join(', ');
      const params = [
        entry.id, entry.repo, entry.scope, entry.topic, entry.kind, entry.title, entry.body,
        JSON.stringify(entry.context.files), JSON.stringify(entry.context.symbols),
        JSON.stringify(entry.context.deps), JSON.stringify(entry.context.tags),
        entry.confidence, entry.author.agent, entry.author.user, entry.author.machine,
        entry.created_at, entry.last_modified_at, entry.last_used_at, entry.use_count,
        JSON.stringify(entry.supersedes), entry.superseded_by, JSON.stringify(entry.warnings),
        hash, entry.lamport, entry.deleted, null,
        embeddingToParam(entry.embedding_v1, this.db.hasVector),
        embeddingToParam(entry.embedding_v2, this.db.hasVector),
      ];
      const updateSet = cols
        .filter((c) => c !== 'id' && c !== 'created_at')
        .map((c) => `${c} = EXCLUDED.${c}`).join(', ');
      await tx.query(
        `INSERT INTO sb_entries (${cols.join(', ')}) VALUES (${placeholders})
         ON CONFLICT (id) DO UPDATE SET ${updateSet}`,
        params
      );
      await tx.query(
        `INSERT INTO sb_audit_log (entry_id, op, who_agent, who_user, who_machine, delta)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [entry.id, opts.fromImport ? 'import' : 'put', entry.author.agent, entry.author.user, entry.author.machine, JSON.stringify({ title: entry.title, kind: entry.kind })]
      );
    });

    return entry;
  }

  /**
   * Soft-delete an entry. Tombstone lives for TOMBSTONE_DAYS, then prunes.
   * Without tombstones, sync re-resurrects deletes from stale peers.
   */
  async forget(id, opts = {}) {
    const ts = new Date().toISOString();
    await this.db.transaction(async (tx) => {
      await tx.query(
        `UPDATE sb_entries SET deleted = TRUE, tombstone_at = $1, last_modified_at = $1, lamport = $2 WHERE id = $3`,
        [ts, nextLamport(), id]
      );
      await tx.query(
        `INSERT INTO sb_audit_log (entry_id, op, who_agent, who_user, who_machine, delta)
         VALUES ($1, 'forget', $2, $3, $4, $5)`,
        [id, opts.author?.agent || 'unknown', opts.author?.user || 'unknown', opts.author?.machine || 'unknown',
         JSON.stringify({ reason: opts.reason || null })]
      );
    });
    return { id, deleted: true, tombstone_at: ts };
  }

  /**
   * Hard-delete entries whose tombstone has aged out.
   */
  async pruneTombstones(now = Date.now()) {
    const cutoff = new Date(now - TOMBSTONE_DAYS * 86400_000).toISOString();
    const res = await this.db.query(
      `DELETE FROM sb_entries WHERE deleted = TRUE AND tombstone_at < $1 RETURNING id`,
      [cutoff]
    );
    return res.length || 0;
  }

  /**
   * Mark an entry used at retrieve-time. Bumps last_used_at and use_count.
   * Used by the retriever; affects decay.
   */
  async markUsed(id) {
    await this.db.query(
      `UPDATE sb_entries SET last_used_at = NOW(), use_count = use_count + 1 WHERE id = $1`,
      [id]
    );
  }

  /**
   * Bulk markUsed.
   */
  async markUsedBatch(ids) {
    if (!ids || ids.length === 0) return;
    const placeholders = ids.map((_, i) => `$${i + 1}`).join(', ');
    await this.db.query(
      `UPDATE sb_entries SET last_used_at = NOW(), use_count = use_count + 1 WHERE id IN (${placeholders})`,
      ids
    );
  }

  /**
   * Apply a confidence delta to multiple entries at once.
   * @param {{ id: string, newConfidence: number }[]} deltas
   */
  async applyConfidence(deltas) {
    if (deltas.length === 0) return;
    await this.db.transaction(async (tx) => {
      for (const d of deltas) {
        await tx.query(
          `UPDATE sb_entries SET confidence = $1 WHERE id = $2`,
          [d.newConfidence, d.id]
        );
      }
    });
  }

  /**
   * Drop entries whose confidence has fallen below the threshold.
   */
  async prune(threshold) {
    const ts = new Date().toISOString();
    const lamport = nextLamport();
    const res = await this.db.query(
      `UPDATE sb_entries SET deleted = TRUE, tombstone_at = $1, lamport = $2
       WHERE deleted = FALSE AND confidence < $3 RETURNING id`,
      [ts, lamport, threshold]
    );
    return res.length || 0;
  }

  // ──────────────────────────────────────────────────────────────────
  // Search (BM25 + vector candidates) — used by retrieval/ranker.mjs.
  // ──────────────────────────────────────────────────────────────────

  /**
   * BM25 candidate generation via Postgres tsvector. Falls back to LIKE on
   * backends without full-text support.
   */
  async candidatesBM25({ query, repo, scope, kind, limit = 50 }) {
    const where = ['deleted = FALSE'];
    const params = [];
    if (repo) { params.push(repo); where.push(`repo = $${params.length}`); }
    if (scope !== undefined && scope !== null) { params.push(scope); where.push(`scope = $${params.length}`); }
    if (kind) { params.push(kind); where.push(`kind = $${params.length}`); }
    params.push(query);
    const tsParam = `$${params.length}`;
    let sql;
    try {
      sql = `
        SELECT *, ts_rank_cd(to_tsvector('english', coalesce(title,'') || ' ' || coalesce(body,'')), plainto_tsquery('english', ${tsParam})) AS bm25
        FROM sb_entries
        WHERE ${where.join(' AND ')}
          AND to_tsvector('english', coalesce(title,'') || ' ' || coalesce(body,'')) @@ plainto_tsquery('english', ${tsParam})
        ORDER BY bm25 DESC LIMIT ${Number.parseInt(limit, 10)}
      `;
      const rows = await this.db.query(sql, params);
      return rows.map((r) => ({ entry: rowToEntry(r), bm25: Number(r.bm25 || 0) }));
    } catch (err) {
      log.debug('tsvector unavailable, falling back to LIKE', { error: err.message });
      // LIKE fallback. Quick and dumb but always works.
      const like = `%${query.replace(/%/g, '').slice(0, 200)}%`;
      params.pop();
      params.push(like);
      const ix = `$${params.length}`;
      sql = `
        SELECT * FROM sb_entries
        WHERE ${where.join(' AND ')} AND (title ILIKE ${ix} OR body ILIKE ${ix})
        ORDER BY last_modified_at DESC LIMIT ${Number.parseInt(limit, 10)}
      `;
      const rows = await this.db.query(sql, params);
      return rows.map((r) => ({ entry: rowToEntry(r), bm25: 0.0 }));
    }
  }

  /**
   * Vector candidate generation. Uses pgvector if available; otherwise
   * pulls all entries with embeddings and sorts in JS (fine up to ~10k).
   */
  async candidatesDense({ embedding, repo, scope, kind, limit = 50 }) {
    if (!embedding || embedding.length === 0) return [];
    const where = ['deleted = FALSE', 'embedding_v1 IS NOT NULL'];
    const params = [];
    if (repo) { params.push(repo); where.push(`repo = $${params.length}`); }
    if (scope !== undefined && scope !== null) { params.push(scope); where.push(`scope = $${params.length}`); }
    if (kind) { params.push(kind); where.push(`kind = $${params.length}`); }
    if (this.db.hasVector) {
      params.push(embeddingToVectorLiteral(embedding));
      const ix = `$${params.length}`;
      const sql = `
        SELECT *, 1 - (embedding_v1 <=> ${ix}::vector) AS sim
        FROM sb_entries
        WHERE ${where.join(' AND ')}
        ORDER BY embedding_v1 <=> ${ix}::vector
        LIMIT ${Number.parseInt(limit, 10)}
      `;
      const rows = await this.db.query(sql, params);
      return rows.map((r) => ({ entry: rowToEntry(r), sim: Number(r.sim || 0) }));
    }
    // Fallback: load + cosine in JS.
    const sql = `SELECT * FROM sb_entries WHERE ${where.join(' AND ')}`;
    const rows = await this.db.query(sql, params);
    const scored = rows.map((r) => {
      const v = parseEmbeddingFromRow(r.embedding_v1);
      const s = v ? cosine(embedding, v) : 0;
      return { entry: rowToEntry(r), sim: s };
    });
    scored.sort((a, b) => b.sim - a.sim);
    return scored.slice(0, limit);
  }

  // ──────────────────────────────────────────────────────────────────
  // Repo administration
  // ──────────────────────────────────────────────────────────────────

  async renameRepo(from, to) {
    const res = await this.db.query(
      `UPDATE sb_entries SET repo = $1, last_modified_at = NOW(), lamport = lamport + 1
       WHERE repo = $2 RETURNING id`,
      [to, from]
    );
    return res.length || 0;
  }

  async dump() {
    return await this.list({ includeDeleted: true });
  }
}

// ─── helpers ────────────────────────────────────────────────────

function rowToEntry(r) {
  if (!r) return null;
  return {
    id: r.id,
    repo: r.repo,
    scope: r.scope ?? null,
    topic: r.topic,
    kind: r.kind,
    title: r.title,
    body: r.body,
    context: {
      files: jsonOrArray(r.ctx_files),
      symbols: jsonOrArray(r.ctx_symbols),
      deps: jsonOrArray(r.ctx_deps),
      tags: jsonOrArray(r.ctx_tags),
    },
    confidence: Number(r.confidence),
    author: { agent: r.author_agent, user: r.author_user, machine: r.author_machine },
    created_at: toIso(r.created_at),
    last_modified_at: toIso(r.last_modified_at),
    last_used_at: r.last_used_at ? toIso(r.last_used_at) : null,
    use_count: Number(r.use_count || 0),
    supersedes: jsonOrArray(r.supersedes),
    superseded_by: r.superseded_by ?? null,
    warnings: jsonOrArray(r.warnings),
    embedding_v1: parseEmbeddingFromRow(r.embedding_v1),
    embedding_v2: parseEmbeddingFromRow(r.embedding_v2),
    lamport: Number(r.lamport || 0),
    deleted: !!r.deleted,
  };
}

function jsonOrArray(v) {
  if (Array.isArray(v)) return v;
  if (v == null) return [];
  if (typeof v === 'string') {
    try { return JSON.parse(v); } catch { return []; }
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
  if (typeof v === 'string') {
    // pgvector text format: '[0.1,0.2,...]'
    if (v.startsWith('[')) {
      try { return JSON.parse(v); } catch {}
    }
  }
  return null;
}

function embeddingToParam(emb, hasVector) {
  if (!emb) return null;
  if (hasVector) return embeddingToVectorLiteral(emb);
  // Store as JSON string, will be roundtripped by parseEmbeddingFromRow.
  return Buffer.from(new Float32Array(emb).buffer);
}

function embeddingToVectorLiteral(emb) {
  return '[' + emb.map((x) => Number(x).toFixed(6)).join(',') + ']';
}

function cosine(a, b) {
  let dot = 0, na = 0, nb = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

// escapeSql removed: all queries now parameterized via $1, $2, ...
// Keeping this stub to make accidental reintroduction a clear test failure.
function escapeSql() {
  throw new Error('escapeSql is removed — use parameterized queries via db.query(sql, params)');
}

export { rowToEntry, ENTRY_KINDS };
