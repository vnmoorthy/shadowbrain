// `shadowbrain repo [list|rename|scope]`
import { withLockedRepo } from './_with-locked-repo.mjs';
import { canonicalizeRemote } from '../trust/policy.mjs';

export async function cmdRepo(action = 'list', _arg, opts = {}) {
  return await withLockedRepo({}, async (repo) => {
    if (action === 'list') {
      const repos = await repo.listRepos();
      for (const r of repos) {
        process.stdout.write(`${r.canonical_url}  (${r.entry_count} entries)\n`);
      }
      return 0;
    }
    if (action === 'rename') {
      if (!opts.from || !opts.to) {
        process.stderr.write('Usage: shadowbrain repo rename --from <old> --to <new>\n');
        return 2;
      }
      const from = canonicalizeRemote(opts.from);
      const to = canonicalizeRemote(opts.to);
      const n = await repo.renameRepo(from, to);
      process.stdout.write(`renamed ${n} entries: ${from} → ${to}\n`);
      return 0;
    }
    process.stderr.write(`unknown action: ${action}\n`);
    return 2;
  });
}
