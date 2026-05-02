// PGLite backend — local-first, zero-network, embedded Postgres in WASM.
//
// This is the default storage for v0.1 solo users. v0.1 ships without
// pgvector and without auto-migrations: the consumer (repository-v01) owns
// its own schema. Keeping this module thin makes future backends (postgres,
// libsql) trivially swappable.
//
// Files written under SHADOWBRAIN_HOME/db/. Survives restarts. Single-writer
// (PGLite is local-process-only). Use src/lock.mjs to enforce that.

import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { defaultDbPath } from './paths.mjs';

/**
 * Open a PGLite-backed storage handle. Does NOT run any migrations — the
 * consumer is responsible for schema setup.
 *
 * @param {{ dbPath?: string, ephemeral?: boolean }} opts
 * @returns {Promise<{ kind: string, exec, query, queryOne, transaction, close }>}
 */
export async function openPgliteBackend(opts = {}) {
  const dbPath = opts.ephemeral ? undefined : opts.dbPath || defaultDbPath();
  if (dbPath) mkdirSync(dirname(dbPath), { recursive: true });

  let PGlite;
  try {
    ({ PGlite } = await import('@electric-sql/pglite'));
  } catch (err) {
    throw new Error(
      `@electric-sql/pglite is required. Install with 'npm install @electric-sql/pglite'. (${err.message})`
    );
  }

  const pg = await PGlite.create(dbPath ? `file://${dbPath}` : undefined);
  return wrapPg(pg, false);
}

function wrapPg(pg, hasVector) {
  return {
    kind: 'pglite',
    raw: pg,
    hasVector,
    async exec(sql) { await pg.exec(sql); },
    async query(sql, params = []) {
      const res = await pg.query(sql, params);
      return res.rows ?? [];
    },
    async queryOne(sql, params = []) {
      const rows = await this.query(sql, params);
      return rows[0] ?? null;
    },
    async transaction(fn) {
      return await pg.transaction(async (tx) => {
        const txHandle = {
          kind: 'pglite',
          hasVector,
          async exec(sql) { await tx.exec(sql); },
          async query(sql, params = []) {
            const res = await tx.query(sql, params);
            return res.rows ?? [];
          },
          async queryOne(sql, params = []) {
            const rows = await this.query(sql, params);
            return rows[0] ?? null;
          },
          async transaction(innerFn) { return await innerFn(this); },
          async close() {},
        };
        return await fn(txHandle);
      });
    },
    async close() { await pg.close?.(); },
  };
}
