// Trust store — read/write ~/.shadowbrain/trust.yaml.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { parse as yamlParse, stringify as yamlStringify } from 'yaml';
import { trustPath } from '../storage/paths.mjs';

const DEFAULT = { version: 1, remotes: {}, monorepos: {} };

export async function loadTrustStore(path = trustPath()) {
  if (!existsSync(path)) {
    return { ...DEFAULT, path };
  }
  try {
    const text = readFileSync(path, 'utf8');
    const parsed = yamlParse(text) || {};
    return {
      version: parsed.version ?? 1,
      remotes: parsed.remotes ?? {},
      monorepos: parsed.monorepos ?? {},
      path,
    };
  } catch (err) {
    return { ...DEFAULT, path, _readError: err.message };
  }
}

export async function saveTrustStore(store) {
  const path = store.path || trustPath();
  mkdirSync(dirname(path), { recursive: true });
  const out = {
    version: store.version ?? 1,
    remotes: store.remotes ?? {},
    monorepos: store.monorepos ?? {},
  };
  writeFileSync(path, yamlStringify(out), { mode: 0o600 });
  store.path = path;
  return store;
}
