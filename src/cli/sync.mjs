// `shadowbrain sync [init|pull|push|status|daemon]`
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
      await pullMirror();
      process.stdout.write('sync pulled.\n');
      return 0;
    case 'push':
      await pushMirror();
      process.stdout.write('sync pushed.\n');
      return 0;
    case 'status': {
      const s = await mirrorStatus();
      process.stdout.write(JSON.stringify(s, null, 2) + '\n');
      return 0;
    }
    case 'daemon':
      await runDaemon();
      return 0;
    default:
      process.stderr.write(`unknown action: ${action}\n`);
      return 2;
  }
}
