// Shared helper for JSON-config-mutating installers.
//
// All the agent installers follow the same pattern: read a JSON config
// file, deep-merge in a `shadowbrain` MCP entry, write a .bak backup, then
// write the modified config back. Centralizing here means a bug-fix in one
// place fixes all 9 hosts.

import { existsSync, readFileSync, writeFileSync, mkdirSync, copyFileSync, renameSync, unlinkSync } from 'node:fs';
import { dirname } from 'node:path';

/**
 * Read a JSON file and return null if missing.
 */
export function readJson(path) {
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    throw new Error(`unparseable JSON at ${path}: ${err.message}`);
  }
}

/**
 * Write a JSON file, atomically, with a .bak of the current contents.
 *
 * We write to <path>.tmp first, fsync-equivalent via writeFileSync's default
 * (Node falls back to fs.writeFileSync's flushed semantics), then rename.
 */
export function writeJsonAtomic(path, obj) {
  mkdirSync(dirname(path), { recursive: true });
  if (existsSync(path)) {
    copyFileSync(path, path + '.bak');
  }
  const tmp = path + '.tmp';
  writeFileSync(tmp, JSON.stringify(obj, null, 2) + '\n');
  // Node has no os.rename guard for atomicity vs same-fs, but writeFileSync's
  // overwrite is atomic enough on POSIX. We use rename for cleanliness.
  renameSync(tmp, path);
}

/**
 * Restore the .bak written by writeJsonAtomic, if present.
 */
export function restoreBak(path) {
  if (existsSync(path + '.bak')) {
    copyFileSync(path + '.bak', path);
    try { unlinkSync(path + '.bak'); } catch {}
    return true;
  }
  return false;
}

/**
 * Standard MCP entry shape. Most hosts (Claude Code, Cursor newer, OpenCode,
 * etc.) use `command + args`. Some (Codex) tweak the keys; their installer
 * adapts.
 */
export function mcpEntry({ command = 'shadowbrain', args = ['serve'], env = {} } = {}) {
  return { command, args, env };
}
