// `shadowbrain conflicts [list|review|resolve] [id]`
import { homedir } from 'node:os';
import { join } from 'node:path';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { withLockedRepo } from './_with-locked-repo.mjs';

const conflictsPath = () => join(homedir(), '.shadowbrain', 'conflicts.jsonl');

export async function cmdConflicts(action = 'list', id, opts = {}) {
  const path = conflictsPath();
  if (!existsSync(path)) {
    process.stdout.write('shadowbrain conflicts: none.\n');
    return 0;
  }
  const lines = readFileSync(path, 'utf8').split('\n').filter(Boolean);
  const items = lines.map((l) => JSON.parse(l));

  if (action === 'list') {
    for (const c of items) {
      process.stdout.write(`${c.id}  ${c.entry_id}  ${c.resolved ? 'resolved' : 'pending'}  (${c.timestamp})\n`);
    }
    return 0;
  }

  if (action === 'review') {
    const pending = items.filter((c) => !c.resolved);
    if (pending.length === 0) {
      process.stdout.write('no pending conflicts.\n');
      return 0;
    }
    process.stdout.write(JSON.stringify(pending, null, 2) + '\n');
    return 0;
  }

  if (action === 'resolve') {
    if (!id || !opts.keep) {
      process.stderr.write("Usage: shadowbrain conflicts resolve <id> --keep mine|theirs|merge\n");
      return 2;
    }
    const idx = items.findIndex((c) => c.id === id);
    if (idx === -1) {
      process.stderr.write(`no such conflict: ${id}\n`);
      return 1;
    }
    const c = items[idx];
    return await withLockedRepo({}, async (repoStore) => {
      let chosen;
      if (opts.keep === 'mine') chosen = c.mine;
      else if (opts.keep === 'theirs') chosen = c.theirs;
      else if (opts.keep === 'merge') chosen = c.merged;
      else {
        process.stderr.write(`invalid --keep value: ${opts.keep}\n`);
        return 2;
      }
      // fromSync: chosen entry already carries the resolver's canonical
      // lamport — must not be re-stamped with the local clock.
      await repoStore.put(chosen, { fromSync: true });
      c.resolved = { keep: opts.keep, resolved_at: new Date().toISOString() };
      items[idx] = c;
      writeFileSync(path, items.map((x) => JSON.stringify(x)).join('\n') + '\n');
      process.stdout.write(`resolved ${id} → ${opts.keep}\n`);
      return 0;
    });
  }

  process.stderr.write(`unknown action: ${action}\n`);
  return 2;
}
