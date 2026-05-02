// `shadowbrain trust [list|set|remove] [target]`
import { loadTrustStore, saveTrustStore } from '../trust/store.mjs';
import { canonicalizeRemote, validTier } from '../trust/policy.mjs';

export async function cmdTrust(action = 'list', target, opts = {}) {
  const store = await loadTrustStore();

  if (action === 'list') {
    const remotes = store.remotes || {};
    const keys = Object.keys(remotes);
    if (keys.length === 0) {
      process.stdout.write('shadowbrain trust: no remotes configured.\n');
      return 0;
    }
    for (const k of keys) {
      process.stdout.write(`${k.padEnd(60)}  ${remotes[k].tier}\n`);
    }
    return 0;
  }

  if (action === 'set') {
    if (!target || !opts.tier) {
      process.stderr.write("Usage: shadowbrain trust set <remote> --tier <read-write|read-only|deny>\n");
      return 2;
    }
    if (!validTier(opts.tier)) {
      process.stderr.write(`invalid tier: ${opts.tier}\n`);
      return 2;
    }
    const canon = canonicalizeRemote(target);
    store.remotes ||= {};
    store.remotes[canon] = { tier: opts.tier, decided_at: new Date().toISOString() };
    await saveTrustStore(store);
    process.stdout.write(`set ${canon} → ${opts.tier}\n`);
    return 0;
  }

  if (action === 'remove') {
    if (!target) {
      process.stderr.write('Usage: shadowbrain trust remove <remote>\n');
      return 2;
    }
    const canon = canonicalizeRemote(target);
    if (store.remotes?.[canon]) {
      delete store.remotes[canon];
      await saveTrustStore(store);
      process.stdout.write(`removed ${canon}\n`);
    } else {
      process.stdout.write('no such remote.\n');
    }
    return 0;
  }

  process.stderr.write(`unknown action: ${action}\n`);
  return 2;
}
