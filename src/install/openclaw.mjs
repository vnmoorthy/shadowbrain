// OpenClaw MCP registration.
//
// Per the gstack notes, OpenClaw spawns Claude Code sessions natively via
// ACP — so MCP entries flow through Claude Code's config. We still drop a
// marker into ~/.openclaw/ so `shadowbrain status` can surface OpenClaw
// users, and we point them at the claude-code installer.

import { existsSync, mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';

const APP_DIR = join(homedir(), '.openclaw');
const MARKER = join(APP_DIR, 'shadowbrain.marker');

export async function detect() { return existsSync(APP_DIR); }
export async function registered() { return existsSync(MARKER); }
export async function plan() { return { config: MARKER, action: 'install via Claude Code (OpenClaw delegates MCP to Claude Code)' }; }
export async function install() {
  mkdirSync(APP_DIR, { recursive: true });
  writeFileSync(MARKER, JSON.stringify({ installed_at: new Date().toISOString(), via: 'claude-code' }));
  return { path: MARKER, note: 'OpenClaw uses Claude Code under the hood — make sure shadowbrain is registered there too.' };
}
export async function uninstall() {
  if (existsSync(MARKER)) { try { unlinkSync(MARKER); } catch {} }
  return { path: MARKER };
}
