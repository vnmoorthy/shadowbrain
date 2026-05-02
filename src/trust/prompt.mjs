// First-encounter trust prompt.
//
// In an MCP-driven session there's no human at a tty, so we expose this as
// a structured "needs decision" response that the agent surfaces to the
// user. CLI flow uses readline.
import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';

import { loadTrustStore, saveTrustStore } from './store.mjs';
import { canonicalizeRemote, validTier } from './policy.mjs';

/**
 * Sticky decision: prompt once, store, never ask again unless --reset.
 * Returns the chosen tier.
 */
export async function promptTier(remoteUrl, { defaultTier = 'read-write', interactive = true } = {}) {
  const canon = canonicalizeRemote(remoteUrl);
  const store = await loadTrustStore();
  if (store.remotes?.[canon]) return store.remotes[canon].tier;

  if (!interactive || !stdin.isTTY) {
    // Non-interactive: deny by default until the user runs
    // `shadowbrain trust set <remote> --tier <tier>`.
    store.remotes ||= {};
    store.remotes[canon] = { tier: 'deny', decided_at: new Date().toISOString(), reason: 'auto-deny: no tty' };
    await saveTrustStore(store);
    return 'deny';
  }

  const rl = readline.createInterface({ input: stdin, output: stdout });
  try {
    stdout.write(`\nshadowbrain — first encounter with remote: ${canon}\n`);
    stdout.write(`  Choose tier: [1] read-write   [2] read-only   [3] deny   [default: ${defaultTier}]\n`);
    const ans = (await rl.question('> ')).trim();
    let tier = defaultTier;
    if (ans === '1' || ans === 'read-write') tier = 'read-write';
    else if (ans === '2' || ans === 'read-only') tier = 'read-only';
    else if (ans === '3' || ans === 'deny') tier = 'deny';
    if (!validTier(tier)) tier = defaultTier;
    store.remotes ||= {};
    store.remotes[canon] = { tier, decided_at: new Date().toISOString() };
    await saveTrustStore(store);
    return tier;
  } finally {
    rl.close();
  }
}
