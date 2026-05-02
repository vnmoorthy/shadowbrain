// Zod-based validators. Single source of truth for runtime shape checks.
// Repo and MCP tool inputs both call validateEntry — divergence between
// what we accept on the wire vs. what we store has bitten enough projects
// that it's worth the redundancy here.
import { z } from 'zod';
import { ENTRY_KINDS } from './kinds.mjs';

const isoDate = z.string().refine((s) => !Number.isNaN(Date.parse(s)), {
  message: 'must be ISO 8601 date string',
});

export const contextSchema = z.object({
  files: z.array(z.string()).default([]),
  symbols: z.array(z.string()).default([]),
  deps: z.array(z.string()).default([]),
  tags: z.array(z.string()).default([]),
});

export const authorSchema = z.object({
  agent: z.string().min(1).max(120),
  user: z.string().min(1).max(120),
  machine: z.string().min(1).max(120),
});

export const entrySchema = z.object({
  id: z.string().regex(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i, {
    message: 'id must be UUIDv7',
  }),
  repo: z.string().min(1).max(500),
  scope: z.string().nullable().default(null),
  topic: z.string().min(1).max(120),
  kind: z.enum(ENTRY_KINDS),
  title: z.string().min(1).max(200),
  body: z.string().min(1).max(60000),
  context: contextSchema,
  confidence: z.number().min(0).max(1),
  author: authorSchema,
  created_at: isoDate,
  last_modified_at: isoDate,
  last_used_at: isoDate.nullable(),
  use_count: z.number().int().min(0),
  supersedes: z.array(z.string()).default([]),
  superseded_by: z.string().nullable().default(null),
  warnings: z.array(z.string()).default([]),
  embedding_v1: z.array(z.number()).nullable().default(null),
  embedding_v2: z.array(z.number()).nullable().default(null),
  lamport: z.number().int().min(0),
  deleted: z.boolean().default(false),
});

export const partialEntrySchema = entrySchema.partial();

/**
 * Validate an entry. Throws ZodError on failure. Returns the typed entry on
 * success (with defaults applied).
 */
export function validateEntry(input) {
  return entrySchema.parse(input);
}

/**
 * Soft validation — returns { ok, value, error } without throwing. Used in
 * the MCP write path where we want to surface a structured error to the
 * agent rather than crash.
 */
export function tryValidateEntry(input) {
  const result = entrySchema.safeParse(input);
  if (result.success) return { ok: true, value: result.data };
  return { ok: false, error: result.error };
}

// Body token size budget. Whitespace tokenized — close enough to GPT-style
// tokenization for our 4,000 ceiling, and we don't need the @anthropic
// tokenizer dep just for a write-side guard.
export const MAX_BODY_TOKENS = 4000;
export function approximateTokenCount(text) {
  if (!text) return 0;
  // Roughly 4 chars per token for English; tighter on code. We use a
  // mix-aware estimator: split on whitespace and count tokens; if the avg
  // word length is high (code-heavy), inflate by 30%.
  const words = text.split(/\s+/).filter(Boolean);
  const avgLen = words.reduce((s, w) => s + w.length, 0) / Math.max(1, words.length);
  const inflate = avgLen > 7 ? 1.3 : 1.0;
  return Math.ceil(words.length * inflate);
}
