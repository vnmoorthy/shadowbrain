// `shadowbrain sync [init|pull|push|status|daemon]`
import { acquireDbLock } from '../lock.mjs';
import { initMirror, pullMirror, pushMirror, mirrorStatus, runDaemon } from '../sync/git-mirror.mjs';

export async function cmdSync(action = 'status', opts = {}) {
  switch (action) {
    case 'init':
      if (!opts.remote) {
        process.stderr.write('Usage: shadowbrain sync init --remote <url>\n');
        return 2;
      }
      await initMirror({ remote: opts.remote });
      process.stdout.write(`sync initialized → ${opts.remote}\n`);
      return 0;
    case 'pull':
      // pullMirror opens the repo internally; lock at the CLI layer so a
      // concurrent `serve` can't corrupt the WAL during a pull.
      return await withLock(async () => {
        await pullMirror();
        process.stdout.write('sync pulled.\n');
        return 0;
      });
    case 'push':
      return await withLock(async () => {
        await pushMirror();
        process.stdout.write('sync pushed.\n');
        return 0;
      });
    case 'status': {
      // status is read-only on the git side and does not open the repo;
      // no lock needed.
      const s = await mirrorStatus();
      process.stdout.write(JSON.stringify(s, null, 2) + '\n');
      return 0;
    }
    case 'daemon':
      // The daemon is a long-running pull-push loop; it acquires the lock
      // for the entire run so no other CLI command can collide with it.
      return await withLock(async () => {
        await runDaemon();
        return 0;
      });
    default:
      process.stderr.write(`unknown action: ${action}\n`);
      return 2;
  }
}

async function withLock(fn) {
  const release = acquireDbLock({});
  try {
    return await fn();
  } finally {
    release();
  }
}
