import { Redactor, DefaultMatchers } from 'pii-redact';

// ---- Credentials -----------------------------------------------------------
// Each pattern runs through String.replace, which resets lastIndex for global
// regexes, so the .test()/lastIndex bug cannot happen. Specific token shapes
// run first, then keyword=value pairs.
const CREDENTIAL_PATTERNS = [
  // Bearer <token> (also covers "Authorization: Bearer <token>")
  /\bBearer\s+[A-Za-z0-9\-._~+/]{8,}=*/gi,
  // OpenAI-style keys: sk-..., sk-proj-...
  /\bsk-[A-Za-z0-9_-]{6,}/g,
  // AWS access key IDs
  /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/g,
  // keyword : value  or  keyword = value
  /\b(?:password|passwd|pwd|secret|client[_-]?secret|api[_-]?key|apikey|access[_-]?key|secret[_-]?key|aws[_-]?secret[_-]?access[_-]?key|auth[_-]?token|access[_-]?token|token|authorization)\b["']?\s*[:=]\s*["']?(?!\[CREDENTIAL\])[^\s"',;]{4,}/gi,
  // "password is hunter2" (password only, to limit false positives)
  /\b(?:password|passwd)\s+is\s+(?!\[CREDENTIAL\])[^\s"',;]{4,}/gi,
];

// ---- PII -------------------------------------------------------------------
// The library's driver_license, zipcode, mention and date_of_birth matchers
// match ordinary words, 5-digit numbers and any date, so they are not used.
const LIB_NAMES = new Set(['email', 'phone', 'ssn', 'ipv4']);
const libMatchers = DefaultMatchers.filter((m) => LIB_NAMES.has(m.name));

function luhnOk(digits) {
  let sum = 0;
  let alt = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let d = digits.charCodeAt(i) - 48;
    if (alt) { d *= 2; if (d > 9) d -= 9; }
    sum += d;
    alt = !alt;
  }
  return sum % 10 === 0;
}

function regexMatcher(name, regex, accept = () => true) {
  return {
    name,
    match(text) {
      const out = [];
      for (const m of text.matchAll(regex)) {
        if (accept(m[0])) out.push({ value: m[0], start: m.index, end: m.index + m[0].length, name });
      }
      return out;
    },
  };
}

const customMatchers = [
  // 13-19 digit card numbers with optional spaces or dashes, Luhn checked
  regexMatcher('credit_card', /\b\d(?:[ -]?\d){12,18}\b/g, (v) => {
    const digits = v.replace(/\D/g, '');
    return digits.length >= 13 && digits.length <= 19 && luhnOk(digits);
  }),
  // International numbers written with a leading +
  regexMatcher('phone', /\+\d{1,3}[\s.-]?\(?\d{1,4}\)?(?:[\s.-]?\d{2,4}){2,4}\b/g),
  // Nigerian mobile numbers, local format, for example 08031234567
  regexMatcher('phone', /\b0[789][01]\d[\s-]?\d{3}[\s-]?\d{4}\b/g),
];

const allMatchers = [...libMatchers, ...customMatchers];
const redactor = new Redactor({ matchers: allMatchers });

/**
 * Redact credentials and PII.
 * Returns { cleaned, categories, total }. categories is { CREDENTIAL: n, EMAIL: n, ... }
 * with non-zero entries only. The original text is never returned or stored.
 */
export function redactPrompt(text) {
  if (typeof text !== 'string') throw new TypeError('text must be a string');
  const categories = {};
  let out = text;

  for (const pattern of CREDENTIAL_PATTERNS) {
    out = out.replace(pattern, () => {
      categories.CREDENTIAL = (categories.CREDENTIAL || 0) + 1;
      return '[CREDENTIAL]';
    });
  }

  // Count each span once, even if two matchers cover it (for example the
  // library phone matcher and the international one).
  const spans = [];
  for (const matcher of allMatchers) {
    for (const r of matcher.match(out)) spans.push({ ...r, cat: (r.name || matcher.name).toUpperCase() });
  }
  spans.sort((a, b) => a.start - b.start || b.end - a.end);
  let lastEnd = -1;
  for (const s of spans) {
    if (s.start >= lastEnd) {
      categories[s.cat] = (categories[s.cat] || 0) + 1;
      lastEnd = s.end;
    }
  }

  out = redactor.redact(out);
  const total = Object.values(categories).reduce((a, b) => a + b, 0);
  return { cleaned: out, categories, total };
}
