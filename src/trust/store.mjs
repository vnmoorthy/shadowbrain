// Trust store — read/write ~/.shadowbrain/trust.yaml.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { parse as yamlParse, stringify as yamlStringify } from 'yaml';
import { trustPath } from '../storage/paths.mjs';
import { log } from '../log.mjs';

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
    // Fail-closed for writes: callers will see no `remotes`, so unknown remotes
    // get the default-deny treatment in canonicalAllowed. But surface the parse
    // error so the user knows their trust.yaml is corrupted — silent fallback
    // hides a config break that affects every write.
    log.warn(`trust.yaml is malformed and was ignored — writes will be denied for all remotes until fixed`, {
      path, error: err.message,
    });
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
