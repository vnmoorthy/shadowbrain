// Synthetic 1000-entry corpus from the 60 seed entries.
//
// Each seed is replicated ~16x with non-destructive perturbations (whitespace,
// rephrasings, partial overlap). The seed id is preserved so the labeled
// queries (gold-corpus.mjs QUERIES) still resolve.

import { SEED_ENTRIES, REPOS, QUERIES } from './gold-corpus.mjs';

const PERTURBATIONS_PER_SEED = 16;

const REPHRASE_HEAD = [
  '', 'Note: ', 'Reminder: ', 'TL;DR — ', 'Heads up: ', 'PSA: ', 'NB: ',
];

const REPHRASE_TAIL = [
  '',
  '\n\nSee related notes in the team wiki.',
  '\n\nLast reviewed Q3.',
  '\n\nReplaces an older approach we used to follow.',
  '\n\nDocumented after the post-mortem.',
];

const NOISE_TAGS = [
  ['legacy'], ['accepted'], ['v2'], ['needs-review'], ['archived'], ['hot'], ['priority'], ['draft'],
];

function pseudoRandom(seedStr) {
  let h = 0;
  for (let i = 0; i < seedStr.length; i++) h = (h * 31 + seedStr.charCodeAt(i)) >>> 0;
  return () => {
    h = (h * 1103515245 + 12345) >>> 0;
    return h / 4294967296;
  };
}

function pick(arr, rand) {
  return arr[Math.floor(rand() * arr.length)];
}

/**
 * Generate the full corpus. Returns an array of plain Entry-like records that
 * can be repo.put-ed.
 */
export function generateCorpus(targetSize = 1000) {
  const out = [];
  for (const seed of SEED_ENTRIES) {
    const rand = pseudoRandom(seed.id);
    out.push({ ...toEntry(seed) });
    for (let i = 0; i < PERTURBATIONS_PER_SEED; i++) {
      const head = pick(REPHRASE_HEAD, rand);
      const tail = pick(REPHRASE_TAIL, rand);
      const tags = [...(seed.tags || []), ...(rand() > 0.7 ? pick(NOISE_TAGS, rand) : [])];
      // Append a per-perturbation counter so content_hash differs and the
      // idempotency dedup doesn't collapse them. Without this we lose ~30%
      // of the corpus.
      out.push({
        seedId: seed.id,
        repo: seed.repo,
        topic: seed.topic,
        kind: seed.kind,
        title: maybeReword(seed.title, rand),
        body: head + seed.body + tail + `\n\n[perturbation #${i + 1}]`,
        context: { tags },
        author: { agent: pick(['claude-code-2.1', 'cursor-0.46', 'codex-0.4'], rand), user: 'corpus', machine: 'gen' },
      });
    }
    if (out.length >= targetSize) break;
  }
  return out.slice(0, targetSize);
}

function maybeReword(title, rand) {
  if (rand() > 0.5) return title;
  // Light rewording — drop short connectives, rephrase a leading verb.
  return title.replace(/\bUse\b/i, 'We use').replace(/\bDo not\b/i, "Don't").replace(/^/, '');
}

function toEntry(seed) {
  return {
    seedId: seed.id,
    repo: seed.repo,
    topic: seed.topic,
    kind: seed.kind,
    title: seed.title,
    body: seed.body,
    context: { tags: seed.tags || [] },
    author: { agent: 'corpus', user: 'corpus', machine: 'gen' },
  };
}

export { QUERIES, REPOS };
