// PII scanner. Configurable per-repo. Default-on for emails, phone numbers,
// SSN-shaped strings; users can opt out per-repo via trust.yaml.
//
// Each finding has a `severity`:
//   - 'block': refuse the write (default for SSN)
//   - 'warn':  attach a warning to the entry but allow the write (default
//              for email + phone — these often legitimately appear in code
//              comments, e.g. "@author alice@example.com")

const DEFAULT_POLICY = {
  email: 'warn',
  phone: 'warn',
  ssn: 'block',
  ipv4: 'off',
  credit_card: 'block',
};

const PATTERNS = {
  email: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
  phone: /\b(?:\+?\d{1,3}[ -]?)?\(?\d{3}\)?[ -]?\d{3}[ -]?\d{4}\b/g,
  // SSN — 3-2-4 with non-zero areas; rule out 666, 900-999.
  ssn: /\b(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}\b/g,
  ipv4: /\b(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\b/g,
  // Luhn-checked credit card. We do the regex first then verify.
  credit_card: /\b(?:\d[ -]*?){13,19}\b/g,
};

/**
 * Scan text for PII.
 * @param {string} text
 * @param {Partial<typeof DEFAULT_POLICY>} [policy]
 * @returns {{ kind: string, sample: string, severity: 'block'|'warn'|'off' }[]}
 */
export function scanForPII(text, policy = {}) {
  const p = { ...DEFAULT_POLICY, ...policy };
  if (!text) return [];
  const findings = [];

  for (const [kind, re] of Object.entries(PATTERNS)) {
    const sev = p[kind];
    if (sev === 'off') continue;
    const matches = text.match(re);
    if (!matches) continue;
    for (const m of matches) {
      if (kind === 'credit_card' && !luhn(m.replace(/[\s-]/g, ''))) continue;
      findings.push({ kind, sample: redact(m), severity: sev });
    }
  }

  return findings;
}

function redact(s) {
  if (s.length <= 6) return s.slice(0, 2) + '***';
  return s.slice(0, 3) + '***' + s.slice(-2);
}

function luhn(num) {
  if (!/^\d+$/.test(num)) return false;
  let sum = 0;
  let alt = false;
  for (let i = num.length - 1; i >= 0; i--) {
    let n = Number.parseInt(num[i], 10);
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
}
