// MCP protocol conformance — the critical-but-easy-to-skip gate.
//
// Spawn `bin/shadowbrain.mjs serve` over stdio, send actual MCP JSON-RPC
// frames, assert the responses parse and behave as expected. Without this,
// "it works in Claude Code" is faith, not evidence.

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { withTmpHome } from '../_helpers/tmp-home.mjs';

const BIN = new URL('../../bin/shadowbrain.mjs', import.meta.url).pathname;

function send(child, msg) {
  child.stdin.write(JSON.stringify(msg) + '\n');
}

async function readUntil(child, predicate, timeoutMs = 8000) {
  return new Promise((resolve, reject) => {
    let buf = '';
    const onData = (chunk) => {
      buf += chunk.toString('utf8');
      let nl;
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (!line.trim()) continue;
        try {
          const msg = JSON.parse(line);
          if (predicate(msg)) {
            child.stdout.off('data', onData);
            clearTimeout(timer);
            resolve(msg);
            return;
          }
        } catch {
          // not JSON-RPC, ignore
        }
      }
    };
    const timer = setTimeout(() => {
      child.stdout.off('data', onData);
      reject(new Error('mcp-protocol: timed out waiting for response'));
    }, timeoutMs);
    child.stdout.on('data', onData);
  });
}

test('mcp protocol: initialize → tools/list → tools/call(memory_put) → tools/call(memory_search)', withTmpHome(async (_t, dir) => {
  // Pre-grant trust for the test repo — v0.5 enforces per-remote write tier.
  const { writeFileSync } = await import('node:fs');
  writeFileSync(`${dir}/trust.yaml`, `version: 1\nremotes:\n  mcp-test/repo:\n    tier: read-write\n    decided_at: 2026-05-02T00:00:00Z\n`);
  const child = spawn(process.execPath, [BIN, 'serve', '--db', join(dir, 'db')], {
    env: { ...process.env, SHADOWBRAIN_HOME: dir, SHADOWBRAIN_LOG: 'silent' },
    stdio: ['pipe', 'pipe', 'pipe'],
  });

  // Drain stderr so the child doesn't block on a full pipe.
  child.stderr.on('data', () => {});

  try {
    // 1) initialize
    send(child, {
      jsonrpc: '2.0', id: 1, method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test', version: '0.0.0' },
      },
    });
    const init = await readUntil(child, (m) => m.id === 1);
    assert.equal(init.jsonrpc, '2.0');
    assert.ok(init.result, `initialize must return result, got ${JSON.stringify(init)}`);
    assert.ok(init.result.serverInfo);
    assert.equal(init.result.serverInfo.name, 'shadowbrain');

    // The MCP spec requires the client to send `initialized` notification
    // after a successful initialize.
    send(child, { jsonrpc: '2.0', method: 'notifications/initialized', params: {} });

    // 2) tools/list
    send(child, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
    const list = await readUntil(child, (m) => m.id === 2);
    assert.ok(list.result?.tools, 'tools/list must return tools array');
    const toolNames = list.result.tools.map((t) => t.name).sort();
    assert.deepEqual(toolNames, ['memory_audit', 'memory_forget', 'memory_get', 'memory_list', 'memory_put', 'memory_search']);

    // 3) tools/call memory_put
    send(child, {
      jsonrpc: '2.0', id: 3, method: 'tools/call',
      params: {
        name: 'memory_put',
        arguments: { title: 'remember pnpm', body: 'we use pnpm not npm', repo: 'mcp-test/repo', kind: 'pattern', topic: 'tooling' },
      },
    });
    const put = await readUntil(child, (m) => m.id === 3);
    assert.ok(put.result?.content, `memory_put result must have content, got ${JSON.stringify(put)}`);
    const putBody = JSON.parse(put.result.content[0].text);
    assert.equal(putBody.ok, true, `expected ok, got: ${JSON.stringify(putBody)}`);
    assert.ok(putBody.entry?.id);

    // 4) tools/call memory_search
    send(child, {
      jsonrpc: '2.0', id: 4, method: 'tools/call',
      params: {
        name: 'memory_search',
        arguments: { query: 'pnpm', repo: 'mcp-test/repo' },
      },
    });
    const search = await readUntil(child, (m) => m.id === 4);
    assert.ok(search.result?.content);
    const sBody = JSON.parse(search.result.content[0].text);
    assert.equal(sBody.ok, true);
    assert.ok(sBody.results.length >= 1);
    // Wrapped in delimiters per the prompt-injection mitigation.
    assert.match(sBody.results[0].text, /<shadowbrain-entry>[\s\S]+<\/shadowbrain-entry>/);

    // 5) tools/call with missing required arg returns isError
    send(child, {
      jsonrpc: '2.0', id: 5, method: 'tools/call',
      params: { name: 'memory_put', arguments: { repo: 'mcp-test/repo' } }, // title+body missing
    });
    const err = await readUntil(child, (m) => m.id === 5);
    assert.ok(err.result?.isError, 'missing required arg must return isError envelope');
    const errBody = JSON.parse(err.result.content[0].text);
    assert.equal(errBody.ok, false);
    assert.equal(errBody.error.code, 'INVALID_ARG');
  } finally {
    try { child.stdin.end(); } catch {}
    child.kill('SIGTERM');
    await new Promise((r) => child.on('exit', r));
  }
}));
