// Defense-in-depth scan pipeline.
//
// Used by the MCP layer (`memory_put`) and the CLI `import` command. Both
// paths feed user-controlled content into the shared memory store; both
// must run the same scans. The flag that gates scanning is intentionally
// loud (`--unsafe`) so an operator who skips it knows they're skipping it.

import { scanForSecrets } from './secrets.mjs';
import { scanForPII } from './pii.mjs';
import { detectAdversarial } from './enricher.mjs';
import { ShadowbrainError, BodyTooLargeError } from '../cli/errors.mjs';
import { MAX_BODY_TOKENS, approximateTokenCount } from '../schema/validators.mjs';

/**
 * Run the secret + PII + adversarial scans against an entry.
 *
 * - Throws SECRET_DETECTED on any secret pattern hit.
 * - Throws PII_DETECTED on any block-severity PII hit.
 * - Throws BodyTooLarge on oversized bodies.
 * - Returns { warnings } from the adversarial enricher; the caller should
 *   merge these into entry.warnings before storing.
 *
 * @param {{ title?: string, body?: string, [k: string]: any }} entry
 * @param {{ piiPolicy?: any }} [opts]
 * @returns {{ warnings: string[] }}
 */
export function runScans(entry, opts = {}) {
  const title = entry.title || '';
  const body = entry.body || '';
  const tokens = approximateTokenCount(body);
  if (tokens > MAX_BODY_TOKENS) {
    throw new BodyTooLargeError({ approxTokens: tokens, max: MAX_BODY_TOKENS });
  }

  const sec = scanForSecrets(`${title}\n${body}`);
  if (sec.length > 0) {
    const err = new ShadowbrainError({
      code: 'SECRET_DETECTED',
      message: `refused: secret-shaped data detected (${sec.map((s) => s.kind).join(', ')})`,
      fix: `redact secrets before storing — never put credentials in shared memory`,
      docsUrl: 'https://github.com/vnmoorthy/shadowbrain/blob/main/docs/SECURITY.md',
    });
    err.findings = sec;
    throw err;
  }

  const pii = scanForPII(`${title}\n${body}`, opts.piiPolicy);
  const blocking = pii.filter((p) => p.severity === 'block');
  if (blocking.length > 0) {
    const err = new ShadowbrainError({
      code: 'PII_DETECTED',
      message: `refused: PII detected (${blocking.map((p) => p.kind).join(', ')})`,
      fix: `redact PII or update the per-repo policy in trust.yaml`,
      docsUrl: 'https://github.com/vnmoorthy/shadowbrain/blob/main/docs/SECURITY.md',
    });
    err.findings = blocking;
    throw err;
  }

  const adv = detectAdversarial(entry);
  return { warnings: adv.map((a) => a.message) };
}
