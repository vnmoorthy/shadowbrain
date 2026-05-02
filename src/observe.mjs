// JSONL observation log — opt-in, redacted, rotated.
//
// Default OFF. Enable with SHADOWBRAIN_OBSERVE=1 (env var) or `serve --observe`.
// Logs ONLY tool-call shape: {timestamp, tool, success, latency_ms, result_count}.
// NEVER logs query content, entry text, tags, or repo names.
//
// Rotation: when the log exceeds 10MB, the file is renamed to `.1` (replacing
// any existing `.1`) and a fresh log starts. One rotation = one prior log
// kept. Cap is 20MB on disk total.

import { existsSync, statSync, renameSync, appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { shadowbrainHome } from './storage/paths.mjs';
import { join } from 'node:path';

const MAX_BYTES = 10 * 1024 * 1024; // 10 MB

let _enabled = null; // null = lazy-resolve once on first call
let _logPath = null;

function resolveEnabled() {
  if (_enabled !== null) return _enabled;
  const v = (process.env.SHADOWBRAIN_OBSERVE || '').toLowerCase();
  _enabled = v === '1' || v === 'true' || v === 'yes';
  return _enabled;
}

function resolveLogPath() {
  if (_logPath) return _logPath;
  _logPath = join(shadowbrainHome(), 'sessions.jsonl');
  return _logPath;
}

/**
 * Force the observe state for testing or for `serve --observe`.
 */
export function setObserveEnabled(value) {
  _enabled = value === true;
}

/**
 * Force the log path (used by tests with isolated SHADOWBRAIN_HOME).
 */
export function resetObservePath() {
  _logPath = null;
}

export function isObserveEnabled() {
  return resolveEnabled();
}

/**
 * Record a tool-call event. No-op when observation is disabled.
 *
 * @param {{ tool: string, success: boolean, latency_ms: number, result_count?: number }} event
 */
export function recordToolEvent(event) {
  if (!resolveEnabled()) return;
  const { tool, success, latency_ms, result_count } = event;
  const sanitized = {
    ts: new Date().toISOString(),
    tool: typeof tool === 'string' ? tool.slice(0, 64) : 'unknown',
    success: !!success,
    latency_ms: Math.round(Number(latency_ms) || 0),
    result_count: typeof result_count === 'number' ? result_count : null,
  };
  const path = resolveLogPath();
  try {
    mkdirSync(dirname(path), { recursive: true });
    rotateIfNeeded(path);
    appendFileSync(path, JSON.stringify(sanitized) + '\n');
  } catch {
    // Logging is best-effort — never crash the MCP server because of it.
  }
}

function rotateIfNeeded(path) {
  if (!existsSync(path)) return;
  const size = statSync(path).size;
  if (size < MAX_BYTES) return;
  const rotated = `${path}.1`;
  try {
    renameSync(path, rotated);
  } catch {
    // If rename fails (Windows lock, etc.), continue appending — better than
    // crashing.
  }
}
