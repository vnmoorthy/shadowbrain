// CLI dispatcher — v0.1 surface only.
//
// Per the /autoplan Eng + DX review: v0.1 ships exactly four commands.
// Everything else (install/uninstall/sync/decay/audit/trust/conflicts/repo/
// import/export) is deferred to v0.5 and lives in src/_deferred/. This
// dispatcher is intentionally narrow so `shadowbrain --help` is honest.

import cac from 'cac';
import { VERSION, NAME } from '../version.mjs';
import { cmdServe } from './serve.mjs';
import { cmdStatus } from './status.mjs';
import { cmdDoctor } from './doctor.mjs';
import { cmdReset } from './reset.mjs';
import { formatErrorForCli } from './errors.mjs';

export async function run(argv) {
  const cli = cac(NAME);
  cli.version(VERSION);
  cli.help();

  cli
    .command('serve', 'start the MCP server (stdio transport, single-session)')
    .option('--db <path>', 'override the database path')
    .option('--observe', 'enable opt-in JSONL observation log (~/.shadowbrain/sessions.jsonl)')
    .action((opts) => guard(() => cmdServe(opts)));

  cli
    .command('doctor', 'run diagnostics — node, home, lock, db, claude CLI, mcp registration')
    .option('--json', 'machine-readable output')
    .option('--no-update-check', 'skip the once-a-day npm version check')
    .option('--no-claude-cli-check', "don't fail if 'claude' is not on PATH")
    .action((opts) => guard(() => cmdDoctor(opts)));

  cli
    .command('status', 'print install status, db location, sync mode')
    .option('--json', 'machine-readable output')
    .action((opts) => guard(() => cmdStatus(opts)));

  cli
    .command('reset', 'wipe ~/.shadowbrain (database + lock + logs). Asks for confirmation.')
    .option('--yes', 'skip the confirmation prompt')
    .action((opts) => guard(() => cmdReset(opts)));

  // CAC's parse() expects argv[0]=node, argv[1]=script. We're called with the
  // user-args slice already stripped, so prepend dummies to give CAC what it
  // wants without forcing the caller to know that detail.
  cli.parse(['node', 'shadowbrain', ...argv], { run: false });

  if (argv.length === 0) {
    cli.outputHelp();
    return 0;
  }
  if (cli.options.version) {
    process.stdout.write(`${NAME}/${VERSION}\n`);
    return 0;
  }
  if (cli.options.help) {
    cli.outputHelp();
    return 0;
  }

  const { matchedCommand } = cli;
  if (!matchedCommand) {
    process.stderr.write(`shadowbrain: unknown command. Try 'shadowbrain --help'.\n`);
    return 2;
  }

  const result = await cli.runMatchedCommand();
  return typeof result === 'number' ? result : 0;
}

async function guard(fn) {
  try {
    return await fn();
  } catch (err) {
    process.stderr.write(formatErrorForCli(err));
    process.exit(1);
  }
}
