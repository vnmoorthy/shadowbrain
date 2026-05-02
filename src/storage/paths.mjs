// Standard paths used everywhere. Single source of truth.
import { homedir } from 'node:os';
import { join } from 'node:path';

export function shadowbrainHome() {
  return process.env.SHADOWBRAIN_HOME || join(homedir(), '.shadowbrain');
}

export function defaultDbPath() {
  return process.env.SHADOWBRAIN_DB || join(shadowbrainHome(), 'db');
}

export function trustPath() {
  return join(shadowbrainHome(), 'trust.yaml');
}

export function configPath() {
  return join(shadowbrainHome(), 'config.json');
}

export function conflictsPath() {
  return join(shadowbrainHome(), 'conflicts.jsonl');
}

export function syncRepoPath() {
  return join(shadowbrainHome(), 'sync');
}

export function modelsCachePath() {
  return process.env.TRANSFORMERS_CACHE || join(shadowbrainHome(), 'models');
}
