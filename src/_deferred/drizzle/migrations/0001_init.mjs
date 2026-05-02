// Migration 0001 — initial schema. Forward + backward.
import { ensureSchema } from '../schema.mjs';

export const id = '0001_init';

export async function up(db, { hasVector }) {
  await ensureSchema(db, hasVector);
  await db.exec(`INSERT INTO sb_meta (key, value) VALUES ('schema_version', '"0001"'::jsonb)
                 ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value;`);
}

export async function down(db) {
  await db.exec(`DROP TABLE IF EXISTS sb_audit_log;`);
  await db.exec(`DROP TABLE IF EXISTS sb_conflicts;`);
  await db.exec(`DROP TABLE IF EXISTS sb_entries;`);
  await db.exec(`DROP TABLE IF EXISTS sb_meta;`);
}
