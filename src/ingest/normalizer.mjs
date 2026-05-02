// Normalizer — turns whatever the agent passed into the canonical Entry shape.
//
// Agents are sloppy. They pass `tags` as a string. They pass `files` as
// `null`. They pass `kind` as `Pattern` instead of `pattern`. We accept
// reasonable shapes and lower the bar to entry without losing the schema's
// guarantees on disk.

import { ENTRY_KINDS } from '../schema/kinds.mjs';

export function normalize(input = {}) {
  const out = { ...input };

  // kind → lowercase, snake-case
  if (out.kind) {
    const k = String(out.kind).toLowerCase().replace(/[\s-]+/g, '_');
    if (ENTRY_KINDS.includes(k)) out.kind = k;
  }

  // Coerce string tags/files → arrays
  if (!out.context) out.context = {};
  for (const f of ['files', 'symbols', 'deps', 'tags']) {
    const v = out.context?.[f];
    if (v == null) out.context[f] = [];
    else if (Array.isArray(v)) out.context[f] = v.map((x) => String(x));
    else if (typeof v === 'string') {
      out.context[f] = v.split(/[,\n]/).map((s) => s.trim()).filter(Boolean);
    } else {
      out.context[f] = [];
    }
  }

  // Trim title and body
  if (typeof out.title === 'string') out.title = out.title.trim();
  if (typeof out.body === 'string') out.body = out.body.trim();

  // Bound confidence
  if (typeof out.confidence === 'number') {
    out.confidence = Math.max(0, Math.min(1, out.confidence));
  }

  return out;
}
