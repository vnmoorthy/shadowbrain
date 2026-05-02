// Claude Code MCP registration.
//
// Two paths in 2026:
//   - ~/.claude.json + project-scoped MCPs in `claude.code.json` per project
//   - the `claude mcp add` CLI is the canonical UX (it edits the right file
//     for project vs user scope)
//
// We prefer the CLI when available because it's stable across Claude Code
// versions. Falls back to direct file edit if not on PATH.

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { readJson, writeJsonAtomic, restoreBak, mcpEntry } from './_jsonpatch.mjs';

const CONFIG_PATH = join(homedir(), '.claude.json');

export async function detect() {
  return existsSync(CONFIG_PATH) || onPath('claude');
}

export async function registered() {
  // Prefer CLI for the source of truth.
  const cli = spawnSync('claude', ['mcp', 'list'], { encoding: 'utf8', timeout: 3000 });
  if (cli.status === 0 && (cli.stdout || '').toLowerCase().includes('shadowbrain')) return true;
  // Fall back to file inspection.
  const cfg = readJson(CONFIG_PATH);
  return !!cfg?.mcpServers?.shadowbrain;
}

export async function plan() {
  return { config: CONFIG_PATH, action: 'add MCP server "shadowbrain" via `claude mcp add`' };
}

export async function install() {
  // Prefer the CLI path.
  if (onPath('claude')) {
    const r = spawnSync('claude', ['mcp', 'add', 'shadowbrain', '--', 'shadowbrain', 'serve'], {
      encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
    });
    if (r.status === 0) return { method: 'cli', stdout: r.stdout?.trim() };
    // CLI failed (e.g. already registered) — fall through to file edit only
    // if the CLI's failure message indicates that it's not the "already
    // registered" case.
    if (!(r.stderr || '').includes('already')) {
      // file fallback below
    } else {
      return { method: 'cli', stdout: '(already registered)' };
    }
  }
  // Direct file edit fallback.
  const cfg = readJson(CONFIG_PATH) || {};
  cfg.mcpServers = cfg.mcpServers || {};
  cfg.mcpServers.shadowbrain = mcpEntry();
  writeJsonAtomic(CONFIG_PATH, cfg);
  return { method: 'file', path: CONFIG_PATH };
}

export async function uninstall() {
  if (onPath('claude')) {
    const r = spawnSync('claude', ['mcp', 'remove', 'shadowbrain'], { encoding: 'utf8' });
    if (r.status === 0) return { method: 'cli' };
  }
  if (existsSync(CONFIG_PATH + '.bak')) restoreBak(CONFIG_PATH);
  else {
    const cfg = readJson(CONFIG_PATH);
    if (cfg?.mcpServers?.shadowbrain) {
      delete cfg.mcpServers.shadowbrain;
      writeJsonAtomic(CONFIG_PATH, cfg);
    }
  }
  return { method: 'file', path: CONFIG_PATH };
}

function onPath(bin) {
  const r = spawnSync('which', [bin], { encoding: 'utf8' });
  return r.status === 0 && (r.stdout || '').trim().length > 0;
}
