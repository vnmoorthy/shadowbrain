// Embedder — produces dense vectors for entries and queries.
//
// Two paths:
//   1. Local: @xenova/transformers running bge-small-en-v1.5 (384 dim, 33MB).
//      No API key needed. First run downloads weights to ~/.shadowbrain/models.
//   2. Remote: optional OpenAI / Voyage / Cohere via env config.
//
// We use a 3rd lightweight fallback for environments where neither is
// available: a deterministic hashing-based embedder. Quality is poor for
// retrieval but it lets the pipeline flow end-to-end so tests don't depend
// on network. The CI-tracked precision@5 number is computed against the
// real model.

import { createHash } from 'node:crypto';
import { log } from '../log.mjs';

let _localPipeline = null;
let _localPipelineP = null;

const DEFAULT_MODEL = 'Xenova/bge-small-en-v1.5';
const DIM = 384;

/**
 * Choose embedder backend from env.
 *   SHADOWBRAIN_EMBEDDER=local|hash|openai|voyage|cohere
 *   default: local if @xenova/transformers loads, else hash.
 */
async function getBackend() {
  const choice = (process.env.SHADOWBRAIN_EMBEDDER || 'local').toLowerCase();
  if (choice === 'hash') return 'hash';
  if (choice === 'openai') return 'openai';
  if (choice === 'voyage') return 'voyage';
  if (choice === 'cohere') return 'cohere';
  // local: try to load @xenova/transformers, fall back to hash if it fails.
  try {
    if (!_localPipelineP) {
      _localPipelineP = (async () => {
        const xenova = await import('@xenova/transformers');
        xenova.env.allowLocalModels = true;
        xenova.env.allowRemoteModels = true;
        const pipe = await xenova.pipeline('feature-extraction', DEFAULT_MODEL, { quantized: true });
        _localPipeline = pipe;
        return pipe;
      })();
    }
    await _localPipelineP;
    return 'local';
  } catch (err) {
    log.warn('local embedder unavailable, falling back to hash embedder', { error: err.message });
    return 'hash';
  }
}

/**
 * Embed a list of strings; returns parallel array of Float-array vectors.
 * @param {string[]} texts
 * @returns {Promise<number[][]>}
 */
export async function embedBatch(texts) {
  const backend = await getBackend();
  if (backend === 'local') return embedLocal(texts);
  if (backend === 'openai') return embedOpenAI(texts);
  if (backend === 'voyage') return embedVoyage(texts);
  if (backend === 'cohere') return embedCohere(texts);
  return texts.map(hashEmbed);
}

/** Single-text convenience. */
export async function embedOne(text) {
  const [v] = await embedBatch([text]);
  return v;
}

async function embedLocal(texts) {
  const out = [];
  for (const t of texts) {
    const result = await _localPipeline(t, { pooling: 'mean', normalize: true });
    out.push(Array.from(result.data));
  }
  return out;
}

async function embedOpenAI(texts) {
  if (!process.env.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY missing');
  const r = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
    body: JSON.stringify({ model: process.env.OPENAI_EMBED_MODEL || 'text-embedding-3-small', input: texts }),
  });
  if (!r.ok) throw new Error(`openai embeddings: ${r.status} ${await r.text()}`);
  const j = await r.json();
  return j.data.map((x) => x.embedding);
}

async function embedVoyage(texts) {
  if (!process.env.VOYAGE_API_KEY) throw new Error('VOYAGE_API_KEY missing');
  const r = await fetch('https://api.voyageai.com/v1/embeddings', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.VOYAGE_API_KEY}` },
    body: JSON.stringify({ model: process.env.VOYAGE_EMBED_MODEL || 'voyage-code-3', input: texts }),
  });
  if (!r.ok) throw new Error(`voyage embeddings: ${r.status} ${await r.text()}`);
  const j = await r.json();
  return j.data.map((x) => x.embedding);
}

async function embedCohere(texts) {
  if (!process.env.COHERE_API_KEY) throw new Error('COHERE_API_KEY missing');
  const r = await fetch('https://api.cohere.ai/v1/embed', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${process.env.COHERE_API_KEY}` },
    body: JSON.stringify({ model: process.env.COHERE_EMBED_MODEL || 'embed-english-v3.0', input_type: 'search_document', texts }),
  });
  if (!r.ok) throw new Error(`cohere embeddings: ${r.status} ${await r.text()}`);
  const j = await r.json();
  return j.embeddings;
}

/**
 * Deterministic hashing embedder. We hash overlapping char-3..char-5 grams
 * into DIM buckets with random-sign projections. Reasonable quality on
 * exact-match queries, terrible on semantic similarity. Used for tests
 * and for installs where the local model can't be downloaded.
 */
export function hashEmbed(text) {
  const v = new Array(DIM).fill(0);
  if (!text) return v;
  const t = text.toLowerCase();
  // Tokens: words + char 3..5 grams.
  const tokens = [];
  for (const w of t.split(/\s+/)) if (w) tokens.push(w);
  for (let n = 3; n <= 5; n++) {
    for (let i = 0; i + n <= t.length; i++) tokens.push(t.slice(i, i + n));
  }
  for (const tok of tokens) {
    const h = createHash('sha1').update(tok).digest();
    const idx = h.readUInt32BE(0) % DIM;
    const sign = (h[4] & 1) ? 1 : -1;
    v[idx] += sign;
  }
  // L2-normalize.
  let norm = 0;
  for (const x of v) norm += x * x;
  norm = Math.sqrt(norm) || 1;
  for (let i = 0; i < v.length; i++) v[i] /= norm;
  return v;
}

export const EMBED_DIM = DIM;
