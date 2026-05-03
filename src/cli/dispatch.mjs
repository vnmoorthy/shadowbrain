// CLI dispatcher — full v0.5 surface.
//
// 14 commands: serve, doctor, status, reset, install, uninstall, audit,
// decay, trust, sync, conflicts, repo, export, import.
//
// Each command lives in its own file under src/cli/. The dispatcher wires
// them up via cac and routes errors through formatErrorForCli for typed
// exit codes + readable messages.

import cac from 'cac';
import { VERSION, NAME } from '../version.mjs';
import { cmdServe } from './serve.mjs';
import { cmdStatus } from './status.mjs';
import { cmdDoctor } from './doctor.mjs';
import { cmdReset } from './reset.mjs';
import { cmdInstall } from './install.mjs';
import { cmdUninstall } from './uninstall.mjs';
import { cmdAudit } from './audit.mjs';
import { cmdDecay } from './decay.mjs';
import { cmdTrust } from './trust.mjs';
import { cmdSync } from './sync.mjs';
import { cmdConflicts } from './conflicts.mjs';
import { cmdExport } from './export.mjs';
import { cmdImport } from './import.mjs';
import { cmdRepo } from './repo.mjs';
import { formatErrorForCli } from './errors.mjs';

export async function run(argv) {
  const cli = cac(NAME);
  cli.version(VERSION);
  cli.help();

  cli.command('serve', 'start the MCP server (stdio transport, single-session)')
    .option('--db <path>', 'override the database path')
    .option('--observe', 'enable opt-in JSONL observation log')
    .action((opts) => guard(() => cmdServe(opts)));

  cli.command('doctor', 'run diagnostics — node, home, lock, db, claude CLI, mcp registration')
    .option('--json', 'machine-readable output')
    .option('--no-update-check', 'skip the once-a-day npm version check')
    .option('--no-claude-cli-check', "don't fail if 'claude' is not on PATH")
    .action((opts) => guard(() => cmdDoctor(opts)));

  cli.command('status', 'print install status, db location, sync mode')
    .option('--json', 'machine-readable output')
    .action((opts) => guard(() => cmdStatus(opts)));

  cli.command('reset', 'wipe ~/.shadowbrain (database + lock + logs). Asks for confirmation.')
    .option('--yes', 'skip the confirmation prompt')
    .action((opts) => guard(() => cmdReset(opts)));

  cli.command('install [agent]', 'register the MCP server with detected coding agents')
    .option('--all', 'install for every detected agent')
    .option('--dry-run', "don't write files, just print the plan")
    .action((agent, opts) => guard(() => cmdInstall(agent, opts)));

  cli.command('uninstall [agent]', 'remove the MCP server registration; restore .bak files')
    .option('--all', 'uninstall from every registered agent')
    .action((agent, opts) => guard(() => cmdUninstall(agent, opts)));

  cli.command('audit', 'list every entry written by every agent + warnings')
    .option('--repo <repo>', 'filter by canonical repo URL')
    .option('--since <iso>', 'filter to entries modified after this timestamp')
    .option('--json', 'machine-readable output')
    .action((opts) => guard(() => cmdAudit(opts)));

  cli.command('decay', 'apply confidence decay and prune entries below the threshold')
    .option('--rate <r>', 'override decay rate per day (default 0.005)', { default: 0.005 })
    .option('--threshold <t>', 'prune entries with confidence below this', { default: 0.05 })
    .option('--dry-run', "don't apply, just print what would happen")
    .option('--json', 'machine-readable output')
    .action((opts) => guard(() => cmdDecay(opts)));

  cli.command('trust [action] [target]', 'manage per-remote trust tiers (list | set | remove)')
    .option('--tier <tier>', 'read-write | read-only | deny')
    .action((action, target, opts) => guard(() => cmdTrust(action, target, opts)));

  cli.command('sync [action]', 'manage git sync (init, pull, push, status, daemon)')
    .option('--remote <url>', 'remote git repo for sync')
    .action((action, opts) => guard(() => cmdSync(action, opts)));

  cli.command('conflicts [action] [id]', 'review and resolve sync conflicts')
    .option('--keep <which>', 'mine | theirs | merge')
    .action((action, id, opts) => guard(() => cmdConflicts(action, id, opts)));

  cli.command('export <file>', 'export entries to a JSONL or YAML file')
    .option('--repo <repo>', 'filter by repo')
    .option('--format <fmt>', 'jsonl | yaml', { default: 'jsonl' })
    .action((file, opts) => guard(() => cmdExport(file, opts)));

  cli.command('import <file>', 'import entries from a JSONL or YAML file')
    .option('--merge', 'merge with existing rather than replace')
    .option('--unsafe', 'SKIP secret/PII/adversarial scans — only for trusted backups')
    .action((file, opts) => guard(() => cmdImport(file, opts)));

  cli.command('repo [action] [arg]', 'manage repos (list | rename)')
    .option('--from <from>', 'old canonical URL')
    .option('--to <to>', 'new canonical URL')
    .action((action, arg, opts) => guard(() => cmdRepo(action, arg, opts)));

  // CAC's parse() expects argv[0]=node, argv[1]=script. We're called with the
  // user-args slice already stripped, so prepend dummies.
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
