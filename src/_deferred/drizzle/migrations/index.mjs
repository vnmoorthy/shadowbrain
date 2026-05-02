// Migration registry. Add new migrations here in order. The runner iterates
// from the highest applied version forward.
import * as m0001 from './0001_init.mjs';

export const MIGRATIONS = [m0001];

/**
 * Apply pending migrations.
 * @param {object} db - backend with exec(sql) and query(sql, params).
 * @param {{ hasVector: boolean }} env
 */
export async function migrate(db, env) {
  await db.exec(`CREATE TABLE IF NOT EXISTS sb_meta (key TEXT PRIMARY KEY, value JSONB);`);
  const rows = await db.query(`SELECT value FROM sb_meta WHERE key = 'schema_version'`);
  const current = rows[0]?.value ? JSON.parse(typeof rows[0].value === 'string' ? rows[0].value : JSON.stringify(rows[0].value)) : null;

  for (const mig of MIGRATIONS) {
    if (current && mig.id <= current) continue;
    await mig.up(db, env);
  }
}
