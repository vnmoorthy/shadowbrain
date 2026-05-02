// Public package entry. v0.1 surface only.
//
// `shadowbrain` (the CLI), `shadowbrain/mcp` (the MCP server, for embedding
// in another runtime), and the slim repo for direct library use.
//
// v0.5+ exports (Repository, postgres backend, retrieval, decay, ingest)
// live in src/_deferred/ and are NOT re-exported.

export { startMcpServer, detectRepo } from './mcp/server.mjs';
export { openRepoV01, SCHEMA_VERSION_V01 } from './storage/repository-v01.mjs';
export { uuidv7 } from './schema/entry.mjs';
export { VERSION, NAME } from './version.mjs';
export {
  ShadowbrainError,
  DbLockedError,
  SchemaMismatchError,
  ClaudeCliMissingError,
  HomeNotWritableError,
  InvalidArgError,
  BodyTooLargeError,
  formatErrorForCli,
} from './cli/errors.mjs';
