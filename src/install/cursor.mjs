// Cursor MCP registration.
//
// Cursor stores MCP config in ~/.cursor/mcp.json (user scope) or
// .cursor/mcp.json in a project folder. We touch the user-scope file.

import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { readJson, writeJsonAtomic, restoreBak, mcpEntry } from './_jsonpatch.mjs';

const CONFIG_PATH = join(homedir(), '.cursor', 'mcp.json');
const APP_DIR_HINT = join(homedir(), '.cursor');

export async function detect() {
  return existsSync(APP_DIR_HINT) || existsSync(CONFIG_PATH);
}

export async function registered() {
  const cfg = readJson(CONFIG_PATH);
  return !!cfg?.mcpServers?.shadowbrain;
}

export async function plan() {
  return { config: CONFIG_PATH, action: 'add MCP server "shadowbrain"' };
}

export async function install() {
  const cfg = readJson(CONFIG_PATH) || {};
  cfg.mcpServers = cfg.mcpServers || {};
  cfg.mcpServers.shadowbrain = mcpEntry();
  writeJsonAtomic(CONFIG_PATH, cfg);
  return { path: CONFIG_PATH };
}

export async function uninstall() {
  if (existsSync(CONFIG_PATH + '.bak')) {
    restoreBak(CONFIG_PATH);
    return { path: CONFIG_PATH };
  }
  const cfg = readJson(CONFIG_PATH);
  if (cfg?.mcpServers?.shadowbrain) {
    delete cfg.mcpServers.shadowbrain;
    writeJsonAtomic(CONFIG_PATH, cfg);
  }
  return { path: CONFIG_PATH };
}
