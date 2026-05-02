import { openPgliteBackend } from '../../src/storage/pglite.mjs';

const db = await openPgliteBackend({ ephemeral: true });
await db.exec(`CREATE TABLE t (title TEXT, body TEXT)`);
await db.query(`INSERT INTO t (title, body) VALUES ($1, $2)`, ['JWT verify', 'we use jose for JWT verification']);
const r1 = await db.query(`SELECT to_tsvector('english', title || ' ' || body) AS v FROM t`);
console.log('vector:', r1[0].v);
const r2 = await db.query(`SELECT plainto_tsquery('english', $1) AS q`, ['how do we verify JWTs']);
console.log('query:', r2[0].q);
const r3 = await db.query(`SELECT title FROM t WHERE to_tsvector('english', title || ' ' || body) @@ plainto_tsquery('english', $1)`, ['how do we verify JWTs']);
console.log('match count:', r3.length);
const r4 = await db.query(`SELECT title FROM t WHERE to_tsvector('english', title || ' ' || body) @@ plainto_tsquery('english', $1)`, ['verify']);
console.log('verify match count:', r4.length);
const r5 = await db.query(`SELECT title FROM t WHERE to_tsvector('english', title || ' ' || body) @@ plainto_tsquery('english', $1)`, ['jwt']);
console.log('jwt match count:', r5.length);
await db.close();
