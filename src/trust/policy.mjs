// Trust policy — per-remote tier enforcement.
//
// Three tiers:
//   read-write  — full access
//   read-only   — searches and reads allowed; writes denied
//   deny        — no access at all
//
// Worktrees and submodules inherit the parent remote's tier.

export const TIERS = Object.freeze(['read-write', 'read-only', 'deny']);

export function validTier(t) {
  return TIERS.includes(t);
}

/**
 * Canonicalize a git remote URL so different forms compare equal.
 *
 *   git@github.com:vnmoorthy/shadowbrain.git
 *   https://github.com/vnmoorthy/shadowbrain.git
 *   https://oauth2:TOKEN@github.com/vnmoorthy/shadowbrain
 *   ssh://git@github.com/vnmoorthy/shadowbrain
 *
 * → all become: github.com/vnmoorthy/shadowbrain
 */
export function canonicalizeRemote(url) {
  if (!url) return '';
  let s = String(url).trim();

  // ssh://user@host/owner/repo
  s = s.replace(/^ssh:\/\//i, '');
  // user@host:owner/repo  →  host/owner/repo
  s = s.replace(/^[^@]+@([^:]+):/i, '$1/');
  // strip protocol
  s = s.replace(/^https?:\/\//i, '');
  s = s.replace(/^git:\/\//i, '');
  // strip embedded auth
  s = s.replace(/^[^@/]+:[^@/]+@/, '');
  s = s.replace(/^[^@/]+@/, '');
  // strip port
  s = s.replace(/:(\d+)\//, '/');
  // strip leading slash, .git suffix, trailing slash
  s = s.replace(/\/+$/, '').replace(/\.git$/, '').replace(/^\/+/, '');
  // lowercase host portion only
  const slash = s.indexOf('/');
  if (slash > 0) {
    s = s.slice(0, slash).toLowerCase() + s.slice(slash);
  } else {
    s = s.toLowerCase();
  }
  return s;
}

/**
 * Decide whether an operation is allowed under the given trust store.
 *
 * @param {{ remotes?: Record<string, { tier: string }> }} store
 * @param {string} canonicalRemote
 * @param {'read'|'write'} op
 */
export function canonicalAllowed(store, canonicalRemote, op) {
  const policy = store?.remotes?.[canonicalRemote];
  if (!policy) {
    // No policy yet — deny by default for writes; allow reads (search) so
    // discovery flows work. The MCP layer prompts on first encounter.
    return op === 'read';
  }
  if (policy.tier === 'deny') return false;
  if (policy.tier === 'read-only') return op === 'read';
  if (policy.tier === 'read-write') return true;
  return false;
}
