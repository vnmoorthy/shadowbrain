// `shadowbrain export <file>` — dump entries to JSONL or YAML.
import { writeFileSync } from 'node:fs';
import { stringify as yamlStringify } from 'yaml';
import { Repository } from '../storage/repository.mjs';

export async function cmdExport(file, opts = {}) {
  const repo = await Repository.open();
  try {
    const filter = opts.repo ? { repo: opts.repo } : {};
    const entries = await repo.list(filter);
    if (opts.format === 'yaml') {
      writeFileSync(file, yamlStringify(entries));
    } else {
      writeFileSync(file, entries.map((e) => JSON.stringify(e)).join('\n') + '\n');
    }
    process.stdout.write(`exported ${entries.length} entries → ${file}\n`);
  } finally {
    await repo.close();
  }
  return 0;
}
