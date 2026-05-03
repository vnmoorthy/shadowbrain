// `shadowbrain import <file>` — load entries from JSONL or YAML.
//
// Imports run the same secret + PII + adversarial scans as memory_put by
// default. A malicious .jsonl could otherwise plant credentials, PII, or
// prompt-injection that auto-syncs to peers via `shadowbrain sync push`.
//
// The `--unsafe` flag bypasses scans for the rare case where you trust
// the source and want to import bit-for-bit (e.g. restoring your own
// backup). It is an intentional, loud opt-out — never the default.
import { readFileSync } from 'node:fs';
import { parse as yamlParse } from 'yaml';
import { withLockedRepo } from './_with-locked-repo.mjs';
import { runScans } from '../ingest/scan-pipeline.mjs';
import { formatErrorForCli } from './errors.mjs';

export async function cmdImport(file, opts = {}) {
  const text = readFileSync(file, 'utf8');
  let entries = [];
  if (file.endsWith('.yaml') || file.endsWith('.yml')) {
    entries = yamlParse(text);
  } else {
    entries = text.split('\n').filter(Boolean).map((l) => JSON.parse(l));
  }
  const skipScans = opts.unsafe === true;
  if (skipScans) {
    process.stderr.write(
      `shadowbrain import: --unsafe set; secret/PII/adversarial scans WILL BE SKIPPED.\n` +
      `Only do this for backups you trust bit-for-bit.\n`
    );
  }

  return await withLockedRepo({}, async (repo) => {
    let imported = 0;
    let refused = 0;
    for (const e of entries) {
      if (!skipScans) {
        try {
          const { warnings } = runScans(e);
          if (warnings.length > 0) {
            e.warnings = [...(e.warnings || []), ...warnings];
          }
        } catch (err) {
          process.stderr.write(`refusing to import ${e.id || '(no id)'}\n`);
          process.stderr.write(formatErrorForCli(err));
          refused++;
          continue;
        }
      }
      // fromSync: preserve any peer-originated lamport / last_modified_at.
      // Imports are conceptually a peer-replay — restamping with the local
      // clock would let imported entries push back as fresh writes.
      await repo.put(e, { fromSync: true });
      imported++;
    }
    process.stdout.write(`imported ${imported} entries from ${file}` +
      (refused > 0 ? `; refused ${refused} (failed scans)` : '') + '\n');
    return refused > 0 && !skipScans ? 1 : 0;
  });
}
