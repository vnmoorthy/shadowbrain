// `shadowbrain decay` — apply confidence decay and prune.
import { Repository } from '../storage/repository.mjs';
import { runDecayJob } from '../decay/job.mjs';

export async function cmdDecay(opts = {}) {
  const repo = await Repository.open();
  try {
    const result = await runDecayJob(repo, {
      rate: Number(opts.rate ?? 0.005),
      threshold: Number(opts.threshold ?? 0.05),
      dryRun: !!opts['dry-run'] || !!opts.dryRun,
    });
    process.stdout.write(`decayed: ${result.decayed}\n`);
    process.stdout.write(`pruned:  ${result.pruned}${opts.dryRun ? ' (dry-run)' : ''}\n`);
    if (opts.json) process.stdout.write(JSON.stringify(result, null, 2));
  } finally {
    await repo.close();
  }
  return 0;
}
