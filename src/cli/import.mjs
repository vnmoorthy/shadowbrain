// `shadowbrain import <file>` — load entries from JSONL or YAML.
import { readFileSync } from 'node:fs';
import { parse as yamlParse } from 'yaml';
import { withLockedRepo } from './_with-locked-repo.mjs';

export async function cmdImport(file, opts = {}) {
  const text = readFileSync(file, 'utf8');
  let entries = [];
  if (file.endsWith('.yaml') || file.endsWith('.yml')) {
    entries = yamlParse(text);
  } else {
    entries = text.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  }
  return await withLockedRepo({}, async (repo) => {
    let count = 0;
    for (const e of entries) {
      // fromSync: preserve any peer-originated lamport / last_modified_at.
      // Imports are conceptually a peer-replay — restamping with the local
      // clock would let imported entries push back as fresh writes.
      await repo.put(e, { fromSync: true });
      count++;
    }
    process.stdout.write(`imported ${count} entries from ${file}\n`);
    return 0;
  });
}
