// `shadowbrain import <file>` — load entries from JSONL or YAML.
import { readFileSync } from 'node:fs';
import { parse as yamlParse } from 'yaml';
import { Repository } from '../storage/repository.mjs';

export async function cmdImport(file, opts = {}) {
  const text = readFileSync(file, 'utf8');
  let entries = [];
  if (file.endsWith('.yaml') || file.endsWith('.yml')) {
    entries = yamlParse(text);
  } else {
    entries = text.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  }
  const repo = await Repository.open();
  let count = 0;
  try {
    for (const e of entries) {
      await repo.put(e, { skipScans: true, fromImport: true, merge: !!opts.merge });
      count++;
    }
    process.stdout.write(`imported ${count} entries from ${file}\n`);
  } finally {
    await repo.close();
  }
  return 0;
}
