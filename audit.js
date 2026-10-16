import crypto from 'node:crypto';

export const GENESIS = '0'.repeat(64);

export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

// Stable JSON: keys sorted, so jsonb key reordering in the database cannot change the hash.
export function canonicalCategories(categories) {
  const sorted = {};
  for (const k of Object.keys(categories || {}).sort()) sorted[k] = categories[k];
  return JSON.stringify(sorted);
}

const iso = (t) => new Date(t).toISOString();

// entry_hash = SHA-256(prev_hash + created_at + prompt_hash + categories)
export function computeEntryHash({ prev_hash, created_at, prompt_hash, redaction_categories }) {
  return sha256(prev_hash + iso(created_at) + prompt_hash + canonicalCategories(redaction_categories));
}

export function buildEntry({ prev_hash, created_at, prompt_hash, redaction_categories }) {
  const base = { prev_hash, created_at: iso(created_at), prompt_hash, redaction_categories };
  return { ...base, entry_hash: computeEntryHash(base) };
}

/**
 * Walk entries (sorted by id ascending). Returns { valid, brokenAtId, checked }.
 * anchor is the prev_hash the first entry must carry (GENESIS for a full log).
 */
export function verifyChain(entries, { anchor = GENESIS } = {}) {
  let expectedPrev = anchor;
  let checked = 0;
  for (const e of entries) {
    checked++;
    if (e.prev_hash !== expectedPrev || computeEntryHash(e) !== e.entry_hash) {
      return { valid: false, brokenAtId: e.id, checked };
    }
    expectedPrev = e.entry_hash;
  }
  return { valid: true, brokenAtId: null, checked };
}

// In-memory store: used in tests and when Supabase is not configured. Not persistent.
export function createMemoryStore() {
  const rows = [];
  return {
    kind: 'memory',
    async append({ prompt_hash, redaction_categories }) {
      const prev_hash = rows.length ? rows[rows.length - 1].entry_hash : GENESIS;
      const entry = { id: rows.length + 1, ...buildEntry({ prev_hash, created_at: new Date(), prompt_hash, redaction_categories }) };
      rows.push(entry);
      return entry;
    },
    async all() { return rows.map((r) => structuredClone(r)); },
    async recent(n) { return rows.slice(-n).map((r) => structuredClone(r)); },
    _rows: rows, // exposed for tests that edit an entry
  };
}

function syntheticChain(n) {
  const rows = [];
  let prev = GENESIS;
  for (let i = 1; i <= n; i++) {
    const e = buildEntry({
      prev_hash: prev,
      created_at: new Date(Date.UTC(2026, 0, i)),
      prompt_hash: sha256(`sample prompt ${i}`),
      redaction_categories: i % 2 ? { EMAIL: 1 } : { CREDENTIAL: 2 },
    });
    rows.push({ id: i, ...e });
    prev = e.entry_hash;
  }
  return rows;
}

/**
 * Tamper demo. Works only on a deep copy. Verifies the copy, edits one entry
 * in the copy, verifies again. Nothing is written anywhere.
 */
export function simulateTamper(realRows) {
  const useReal = realRows.length >= 3;
  const rows = useReal ? structuredClone(realRows) : syntheticChain(5);
  const source = useReal
    ? `copy of the last ${rows.length} real entries`
    : 'synthetic sample (the log has fewer than 3 entries)';
  const anchor = rows[0].prev_hash;
  const before = verifyChain(rows, { anchor });

  const target = rows[Math.floor(rows.length / 2)];
  const original = target.prompt_hash;
  target.prompt_hash = (original[0] === '0' ? '1' : '0') + original.slice(1);
  const after = verifyChain(rows, { anchor });

  return {
    source,
    tamperedId: target.id,
    change: { field: 'prompt_hash', before: original.slice(0, 12), after: target.prompt_hash.slice(0, 12) },
    before,
    after,
    note: 'The edit was made on a copy in memory. No stored data was changed.',
  };
}
