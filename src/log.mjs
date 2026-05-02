// Tiny structured logger. Writes to stderr so MCP stdio (stdout) is clean.
// Levels: trace, debug, info, warn, error. Default: info.
// Override with SHADOWBRAIN_LOG=debug or SHADOWBRAIN_LOG=silent.

const LEVELS = { trace: 10, debug: 20, info: 30, warn: 40, error: 50, silent: 99 };

function envLevel() {
  const l = (process.env.SHADOWBRAIN_LOG || 'info').toLowerCase();
  return LEVELS[l] ?? LEVELS.info;
}

let current = envLevel();

export function setLevel(level) {
  current = LEVELS[level] ?? current;
}

function emit(level, msg, meta) {
  if (LEVELS[level] < current) return;
  const line = {
    t: new Date().toISOString(),
    lvl: level,
    msg: typeof msg === 'string' ? msg : String(msg),
    ...(meta && typeof meta === 'object' ? meta : {}),
  };
  // Pretty in TTY, JSON otherwise. MCP stdio always gets JSON via stderr.
  if (process.stderr.isTTY && process.env.SHADOWBRAIN_LOG_JSON !== '1') {
    const colorMap = { trace: '\x1b[90m', debug: '\x1b[36m', info: '\x1b[32m', warn: '\x1b[33m', error: '\x1b[31m' };
    const reset = '\x1b[0m';
    const c = colorMap[level] || '';
    let extras = '';
    if (meta && typeof meta === 'object') {
      const keys = Object.keys(meta);
      if (keys.length > 0) {
        extras = ' ' + keys.map((k) => `${k}=${JSON.stringify(meta[k])}`).join(' ');
      }
    }
    process.stderr.write(`${c}${level.padEnd(5)}${reset} ${line.msg}${extras}\n`);
  } else {
    process.stderr.write(JSON.stringify(line) + '\n');
  }
}

export const log = {
  trace: (m, meta) => emit('trace', m, meta),
  debug: (m, meta) => emit('debug', m, meta),
  info: (m, meta) => emit('info', m, meta),
  warn: (m, meta) => emit('warn', m, meta),
  error: (m, meta) => emit('error', m, meta),
};
