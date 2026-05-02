// `shadowbrain reset` — wipe ~/.shadowbrain so the user can recover from a
// schema mismatch or a poisoned dataset. Ask before doing it.
import { existsSync, rmSync, statSync, readdirSync } from 'node:fs';
import readline from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import { shadowbrainHome } from '../storage/paths.mjs';

export async function cmdReset(opts = {}) {
  const home = shadowbrainHome();
  if (!existsSync(home)) {
    process.stdout.write(`shadowbrain reset: ${home} does not exist — nothing to do.\n`);
    return 0;
  }

  const sizeMb = (dirSize(home) / (1024 * 1024)).toFixed(2);
  if (!opts.yes) {
    if (!stdin.isTTY) {
      process.stderr.write(
        `shadowbrain reset: refusing to wipe ${home} (~${sizeMb}MB) non-interactively. Re-run with --yes to confirm.\n`
      );
      return 1;
    }
    const rl = readline.createInterface({ input: stdin, output: stdout });
    try {
      const ans = await rl.question(`Wipe ${home} (~${sizeMb}MB)? type 'yes' to confirm: `);
      if (ans.trim().toLowerCase() !== 'yes') {
        process.stdout.write('aborted.\n');
        return 1;
      }
    } finally {
      rl.close();
    }
  }

  rmSync(home, { recursive: true, force: true });
  process.stdout.write(`shadowbrain reset: removed ${home}\n`);
  return 0;
}

function dirSize(p) {
  let total = 0;
  try {
    for (const entry of readdirSync(p, { withFileTypes: true })) {
      const full = `${p}/${entry.name}`;
      if (entry.isDirectory()) total += dirSize(full);
      else if (entry.isFile()) total += statSync(full).size;
    }
  } catch {}
  return total;
}
