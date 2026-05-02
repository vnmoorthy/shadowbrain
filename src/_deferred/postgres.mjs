// Postgres backend — Supabase Session Pooler URL or any Postgres 14+.
// pgvector required for the dense retrieval index; if missing, the backend
// throws on open and tells the user how to enable.

import { migrate } from './drizzle/migrations/index.mjs';
import { log } from '../log.mjs';

/**
 * Open a Postgres-backed storage handle.
 * @param {{ url: string }} opts
 */
export async function openPostgresBackend(opts) {
  if (!opts?.url) throw new Error('postgres backend requires a url');
  let pgModule;
  try {
    pgModule = await import('pg');
  } catch (err) {
    throw new Error(
      `pg is required for the postgres backend. Install with 'npm install pg'. (${err.message})`
    );
  }
  const { Pool } = pgModule.default || pgModule;
  const pool = new Pool({ connectionString: opts.url, max: 4 });

  let hasVector = false;
  const c = await pool.connect();
  try {
    try {
      await c.query(`CREATE EXTENSION IF NOT EXISTS vector;`);
      hasVector = true;
    } catch (e) {
      log.warn('pgvector extension not enabled — dense retrieval will fall back to JS cosine.', { error: e.message });
    }
  } finally {
    c.release();
  }

  const handle = wrapPg(pool, hasVector);
  await migrate(handle, { hasVector });
  return handle;
}

function wrapPg(pool, hasVector) {
  return {
    kind: 'postgres',
    raw: pool,
    hasVector,
    async exec(sql) {
      const c = await pool.connect();
      try { await c.query(sql); } finally { c.release(); }
    },
    async query(sql, params = []) {
      const res = await pool.query(sql, params);
      return res.rows;
    },
    async queryOne(sql, params = []) {
      const rows = await this.query(sql, params);
      return rows[0] ?? null;
    },
    async transaction(fn) {
      const c = await pool.connect();
      try {
        await c.query('BEGIN');
        const txHandle = {
          kind: 'postgres',
          hasVector,
          async exec(sql) { await c.query(sql); },
          async query(sql, params = []) { const res = await c.query(sql, params); return res.rows; },
          async queryOne(sql, params = []) { const rows = await this.query(sql, params); return rows[0] ?? null; },
          async transaction(innerFn) { return await innerFn(this); },
          async close() {},
        };
        const result = await fn(txHandle);
        await c.query('COMMIT');
        return result;
      } catch (err) {
        await c.query('ROLLBACK');
        throw err;
      } finally {
        c.release();
      }
    },
    async close() { await pool.end(); },
  };
}
