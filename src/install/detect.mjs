// Agent detection + per-agent installer registry.
//
// Each installer module exports { plan, install, uninstall, registered() }.
// detectAgents() returns a list of `{ name, installed, registered }` we use
// to drive the CLI and the install.sh experience.

import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';

import * as claudeCode from './claude-code.mjs';
import * as cursor from './cursor.mjs';
import * as codex from './codex.mjs';
import * as opencode from './opencode.mjs';
import * as factory from './factory.mjs';
import * as slate from './slate.mjs';
import * as hermes from './hermes.mjs';
import * as kiro from './kiro.mjs';
import * as openclaw from './openclaw.mjs';

export const INSTALLERS = {
  'claude-code': claudeCode,
  cursor,
  codex,
  opencode,
  factory,
  slate,
  hermes,
  kiro,
  openclaw,
};

/**
 * Detect which agents are installed on this machine and which already have
 * shadowbrain registered. Cheap probes — no network.
 */
export async function detectAgents() {
  const results = [];
  for (const [name, mod] of Object.entries(INSTALLERS)) {
    let installed = false;
    let registered = false;
    try {
      installed = await mod.detect();
      registered = installed ? await mod.registered() : false;
    } catch {}
    results.push({ name, installed, registered });
  }
  return results;
}

/**
 * Helper: is a binary on PATH? Used by several installers.
 */
export function onPath(bin) {
  const r = spawnSync('which', [bin], { encoding: 'utf8' });
  return r.status === 0 && (r.stdout || '').trim().length > 0;
}

/**
 * Helper: read JSON safely.
 */
export function readJsonSafe(path) {
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return null;
  }
}

export const HOME_PATHS = {
  home: homedir(),
  exists: (p) => existsSync(p),
  join,
};
