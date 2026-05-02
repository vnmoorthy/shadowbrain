// OpenCode MCP registration. Config at ~/.config/opencode/config.json.
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { readJson, writeJsonAtomic, restoreBak, mcpEntry } from './_jsonpatch.mjs';

const APP_DIR = join(homedir(), '.config', 'opencode');
const CONFIG_PATH = join(APP_DIR, 'config.json');

export async function detect() { return existsSync(APP_DIR); }
export async function registered() {
  const cfg = readJson(CONFIG_PATH);
  return !!cfg?.mcpServers?.shadowbrain;
}
export async function plan() { return { config: CONFIG_PATH, action: 'add mcpServers.shadowbrain' }; }
export async function install() {
  const cfg = readJson(CONFIG_PATH) || {};
  cfg.mcpServers = cfg.mcpServers || {};
  cfg.mcpServers.shadowbrain = mcpEntry();
  writeJsonAtomic(CONFIG_PATH, cfg);
  return { path: CONFIG_PATH };
}
export async function uninstall() {
  if (existsSync(CONFIG_PATH + '.bak')) { restoreBak(CONFIG_PATH); return { path: CONFIG_PATH }; }
  const cfg = readJson(CONFIG_PATH);
  if (cfg?.mcpServers?.shadowbrain) { delete cfg.mcpServers.shadowbrain; writeJsonAtomic(CONFIG_PATH, cfg); }
  return { path: CONFIG_PATH };
}
