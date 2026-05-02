// Canonical Entry shape, UUIDv7 generator, content-hash helper.
//
// We don't bring in `uuid` — UUIDv7 is implementable in 30 lines and we
// don't want a dep solely for it.
import { randomBytes, createHash } from 'node:crypto';

/**
 * Generate a UUIDv7 — 48-bit ms timestamp, 4-bit version, 12-bit rand-a,
 * 2-bit variant, 62-bit rand-b. Time-sortable, collision-resistant.
 * Per RFC 9562 (the published form of the v7 draft).
 */
export function uuidv7() {
  const ms = BigInt(Date.now());
  const rand = randomBytes(10);
  const bytes = Buffer.alloc(16);
  bytes.writeUIntBE(Number((ms >> 16n) & 0xffffffffn), 0, 4);
  bytes.writeUIntBE(Number(ms & 0xffffn), 4, 2);
  bytes[6] = 0x70 | (rand[0] & 0x0f);
  bytes[7] = rand[1];
  bytes[8] = 0x80 | (rand[2] & 0x3f);
  bytes.set(rand.subarray(3, 10), 9);
  const h = bytes.toString('hex');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/**
 * Stable content hash used for idempotency and conflict detection. We hash
 * (repo, scope, topic, kind, title, body) — the user-meaningful core, not
 * timestamps or vector blobs.
 */
export function entryContentHash(entry) {
  const norm = JSON.stringify({
    r: entry.repo || '',
    s: entry.scope || null,
    t: entry.topic || '',
    k: entry.kind || '',
    h: (entry.title || '').trim(),
    b: (entry.body || '').trim(),
  });
  return createHash('sha256').update(norm).digest('hex');
}

/**
 * Lamport timestamp pair (wall, monotonic). Survives clock skew between
 * machines: we sort by wall first, then by monotonic counter from the same
 * machine. Stored in `last_modified_at` plus an internal `lamport` counter.
 */
let _lamport = 0;
export function nextLamport() {
  return ++_lamport;
}
export function setLamport(n) {
  _lamport = Math.max(_lamport, n | 0);
}

/**
 * Empty Entry skeleton with safe defaults. Callers fill in repo/topic/title/
 * body and `validateEntry` confirms.
 */
export function newEntry(partial = {}) {
  const now = new Date().toISOString();
  return {
    id: partial.id ?? uuidv7(),
    repo: partial.repo ?? '',
    scope: partial.scope ?? null,
    topic: partial.topic ?? '',
    kind: partial.kind ?? 'pattern',
    title: partial.title ?? '',
    body: partial.body ?? '',
    context: {
      files: partial.context?.files ?? [],
      symbols: partial.context?.symbols ?? [],
      deps: partial.context?.deps ?? [],
      tags: partial.context?.tags ?? [],
    },
    confidence: typeof partial.confidence === 'number' ? partial.confidence : 0.7,
    author: {
      agent: partial.author?.agent ?? 'unknown',
      user: partial.author?.user ?? 'unknown',
      machine: partial.author?.machine ?? 'unknown',
    },
    created_at: partial.created_at ?? now,
    last_modified_at: partial.last_modified_at ?? now,
    last_used_at: partial.last_used_at ?? null,
    use_count: partial.use_count ?? 0,
    supersedes: partial.supersedes ?? [],
    superseded_by: partial.superseded_by ?? null,
    warnings: partial.warnings ?? [],
    embedding_v1: partial.embedding_v1 ?? null,
    embedding_v2: partial.embedding_v2 ?? null,
    lamport: partial.lamport ?? nextLamport(),
    deleted: partial.deleted ?? false,
  };
}
