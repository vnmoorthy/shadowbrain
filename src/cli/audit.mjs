// `shadowbrain audit` — list all entries with provenance and warnings.
import { Repository } from '../storage/repository.mjs';

export async function cmdAudit(opts = {}) {
  const repo = await Repository.open();
  try {
    const filter = {};
    if (opts.repo) filter.repo = opts.repo;
    if (opts.since) filter.since = opts.since;
    const entries = await repo.list(filter);
    let warnCount = 0;
    process.stdout.write(`shadowbrain audit — ${entries.length} entries\n`);
    process.stdout.write(`${'id'.padEnd(36)}  ${'kind'.padEnd(13)}  ${'repo/topic'.padEnd(40)}  conf  warnings\n`);
    for (const e of entries) {
      if (e.warnings?.length) warnCount++;
      const repoTopic = `${shorten(e.repo, 28)}/${e.topic}`.padEnd(40);
      process.stdout.write(
        `${e.id}  ${e.kind.padEnd(13)}  ${repoTopic}  ${e.confidence.toFixed(2)}  ${e.warnings?.length || 0}\n`
      );
    }
    if (warnCount > 0) process.stdout.write(`\n${warnCount} entries have warnings — run with --json to see them.\n`);
    if (opts.json) process.stdout.write(JSON.stringify(entries, null, 2));
  } finally {
    await repo.close();
  }
  return 0;
}

function shorten(s, n) {
  if (!s) return '';
  if (s.length <= n) return s;
  return '…' + s.slice(s.length - n + 1);
}
