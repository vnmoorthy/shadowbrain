// Single source of truth for version. Read from package.json at runtime so
// publish bumps don't need a code change.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(readFileSync(join(here, '..', 'package.json'), 'utf8'));

export const VERSION = pkg.version;
export const NAME = pkg.name;
