// Codex CLI MCP registration.
//
// OpenAI's Codex CLI uses ~/.codex/config.toml in newer versions and
// ~/.codex/settings.json in older. We support both.

import { existsSync, readFileSync, writeFileSync, copyFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { homedir } from 'node:os';
import { readJson, writeJsonAtomic, restoreBak } from './_jsonpatch.mjs';

const APP_DIR = join(homedir(), '.codex');
const SETTINGS_JSON = join(APP_DIR, 'settings.json');
const CONFIG_TOML = join(APP_DIR, 'config.toml');

export async function detect() {
  return existsSync(APP_DIR);
}

export async function registered() {
  if (existsSync(SETTINGS_JSON)) {
    const cfg = readJson(SETTINGS_JSON);
    if (cfg?.mcp_servers?.shadowbrain || cfg?.mcpServers?.shadowbrain) return true;
  }
  if (existsSync(CONFIG_TOML)) {
    const text = readFileSync(CONFIG_TOML, 'utf8');
    return /\[mcp_servers\.shadowbrain\]/.test(text);
  }
  return false;
}

export async function plan() {
  const target = existsSync(CONFIG_TOML) ? CONFIG_TOML : SETTINGS_JSON;
  return { config: target, action: 'add mcp_servers.shadowbrain' };
}

export async function install() {
  if (existsSync(CONFIG_TOML)) {
    const text = readFileSync(CONFIG_TOML, 'utf8');
    if (/\[mcp_servers\.shadowbrain\]/.test(text)) return { path: CONFIG_TOML, action: 'noop' };
    copyFileSync(CONFIG_TOML, CONFIG_TOML + '.bak');
    const append = `\n[mcp_servers.shadowbrain]\ncommand = "shadowbrain"\nargs = ["serve"]\n`;
    writeFileSync(CONFIG_TOML, text + append);
    return { path: CONFIG_TOML };
  }
  // settings.json path (older Codex)
  mkdirSync(dirname(SETTINGS_JSON), { recursive: true });
  const cfg = readJson(SETTINGS_JSON) || {};
  cfg.mcp_servers = cfg.mcp_servers || {};
  cfg.mcp_servers.shadowbrain = { command: 'shadowbrain', args: ['serve'] };
  writeJsonAtomic(SETTINGS_JSON, cfg);
  return { path: SETTINGS_JSON };
}

export async function uninstall() {
  if (existsSync(CONFIG_TOML + '.bak')) {
    copyFileSync(CONFIG_TOML + '.bak', CONFIG_TOML);
    const { unlinkSync } = await import('node:fs');
    try { unlinkSync(CONFIG_TOML + '.bak'); } catch {}
    return { path: CONFIG_TOML };
  }
  if (existsSync(CONFIG_TOML)) {
    const text = readFileSync(CONFIG_TOML, 'utf8');
    const cleaned = text.replace(/\n\[mcp_servers\.shadowbrain\][\s\S]*?(?=\n\[|\n*$)/g, '');
    writeFileSync(CONFIG_TOML, cleaned);
    return { path: CONFIG_TOML };
  }
  if (existsSync(SETTINGS_JSON + '.bak')) {
    restoreBak(SETTINGS_JSON);
    return { path: SETTINGS_JSON };
  }
  if (existsSync(SETTINGS_JSON)) {
    const cfg = readJson(SETTINGS_JSON);
    if (cfg?.mcp_servers?.shadowbrain) {
      delete cfg.mcp_servers.shadowbrain;
      writeJsonAtomic(SETTINGS_JSON, cfg);
    }
  }
  return { path: SETTINGS_JSON };
}
