// Secret scanner — defense-in-depth before any write.
//
// We block a write when we see anything that looks like a credential. This
// pattern bank is conservative (some false positives are acceptable; a
// false negative is an exfiltration). Patterns lifted from gitleaks and
// trufflehog with provenance noted inline.

const PATTERNS = [
  // AWS
  { kind: 'aws_access_key', re: /AKIA[0-9A-Z]{16}/ },
  { kind: 'aws_secret_key', re: /(?:aws_secret|aws_secret_access_key)[\s"'=:]{1,5}([A-Za-z0-9/+=]{40})/ },
  // GCP
  { kind: 'gcp_service_account', re: /"type"\s*:\s*"service_account"/ },
  { kind: 'gcp_api_key', re: /AIza[0-9A-Za-z\-_]{35}/ },
  // GitHub
  { kind: 'github_pat_classic', re: /\bghp_[A-Za-z0-9]{36}\b/ },
  { kind: 'github_pat_fine', re: /\bgithub_pat_[A-Za-z0-9_]{82}\b/ },
  { kind: 'github_oauth', re: /\bgho_[A-Za-z0-9]{36}\b/ },
  { kind: 'github_app', re: /\b(ghu|ghs)_[A-Za-z0-9]{36}\b/ },
  // OpenAI / Anthropic
  { kind: 'openai_key', re: /sk-(?:proj-|live_|test_)?[A-Za-z0-9_-]{30,}/ },
  { kind: 'anthropic_key', re: /sk-ant-[A-Za-z0-9_-]{30,}/ },
  // Stripe
  { kind: 'stripe_secret', re: /\bsk_(live|test)_[A-Za-z0-9]{24,}\b/ },
  { kind: 'stripe_publishable', re: /\bpk_(live|test)_[A-Za-z0-9]{24,}\b/ },
  // Slack
  { kind: 'slack_token', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/ },
  // Generic JWT
  { kind: 'jwt', re: /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{20,}/ },
  // PEM blocks
  { kind: 'pem_private_key', re: /-----BEGIN (?:RSA |DSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/ },
  // Twilio
  { kind: 'twilio_sid', re: /\bAC[a-f0-9]{32}\b/ },
  // SendGrid
  { kind: 'sendgrid_key', re: /\bSG\.[A-Za-z0-9_-]{22}\.[A-Za-z0-9_-]{43}\b/ },
  // npm
  { kind: 'npm_token', re: /\bnpm_[A-Za-z0-9]{36}\b/ },
  // Supabase service-role JWT (jwt pattern catches this; left in for clarity)
  // Square
  { kind: 'square_token', re: /\bsq0(idp|csp|atp)-[A-Za-z0-9_-]{22,}\b/ },
];

const HIGH_ENTROPY_THRESHOLD = 4.5; // shannon bits/char

/**
 * Scan text for credential-shaped data. Returns an array of findings.
 * Empty array means clean.
 */
export function scanForSecrets(text) {
  if (!text) return [];
  const findings = [];
  for (const p of PATTERNS) {
    const m = text.match(p.re);
    if (m) findings.push({ kind: p.kind, sample: redact(m[0]) });
  }

  // Generic high-entropy strings near `key|token|secret|password` markers.
  const ctxRe = /(?:key|token|secret|password|passwd|api[_-]?key|auth)[\s"'=:]{1,5}([A-Za-z0-9/+_=-]{20,})/gi;
  let mm;
  while ((mm = ctxRe.exec(text)) !== null) {
    const candidate = mm[1];
    if (shannonEntropy(candidate) > HIGH_ENTROPY_THRESHOLD) {
      findings.push({ kind: 'high_entropy_secret', sample: redact(candidate) });
    }
  }

  return dedupeFindings(findings);
}

function dedupeFindings(arr) {
  const seen = new Set();
  return arr.filter((f) => {
    const k = `${f.kind}:${f.sample}`;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

function redact(s) {
  if (s.length <= 8) return s.slice(0, 2) + '***';
  return s.slice(0, 4) + '***' + s.slice(-2);
}

/**
 * Shannon entropy in bits per character.
 */
export function shannonEntropy(s) {
  const counts = new Map();
  for (const ch of s) counts.set(ch, (counts.get(ch) || 0) + 1);
  let h = 0;
  for (const c of counts.values()) {
    const p = c / s.length;
    h -= p * Math.log2(p);
  }
  return h;
}
