// `shadowbrain serve` — acquire writer lock, start MCP server.
import { acquireDbLock } from '../lock.mjs';
import { startMcpServer } from '../mcp/server.mjs';
import { setObserveEnabled } from '../observe.mjs';
import { log } from '../log.mjs';

export async function cmdServe(opts = {}) {
  if (opts.observe) setObserveEnabled(true);

  // Acquire the single-writer lock before opening PGLite — refuses early if
  // another shadowbrain is already running.
  const release = acquireDbLock({});

  try {
    const { coldStartMs } = await startMcpServer({ dbPath: opts.db });
    log.info('shadowbrain serve started', { coldStartMs });
    // For stdio, server.connect() returns once the transport reads the
    // initialize handshake; the parent agent now drives the lifetime.
    // Block here so the lock stays held until the parent disconnects.
    await new Promise((resolve) => {
      process.stdin.once('end', resolve);
      process.stdin.once('close', resolve);
      process.once('SIGINT', resolve);
      process.once('SIGTERM', resolve);
    });
    return 0;
  } finally {
    release();
  }
}
