import { GENESIS, buildEntry } from './audit.js';

const PAGE = 1000;
const MAX_APPEND_TRIES = 5;

/**
 * Audit store backed by Supabase PostgREST. Uses fetch, no extra dependency.
 * The service key is read from the environment by the caller and sent only
 * from the server, never to the browser.
 */
export function createSupabaseStore({ url, serviceKey, fetchImpl = fetch }) {
  const table = `${url.replace(/\/+$/, '')}/rest/v1/audit_log`;
  // New-style secret keys (sb_secret_...) are not JWTs and go in apikey only.
  const headers = { apikey: serviceKey, 'Content-Type': 'application/json' };
  if (!serviceKey.startsWith('sb_')) headers.Authorization = `Bearer ${serviceKey}`;

  const call = (query, init = {}) =>
    fetchImpl(table + query, { ...init, headers: { ...headers, ...(init.headers || {}) }, signal: AbortSignal.timeout(10000) });

  const normalize = (r) => ({ ...r, created_at: new Date(r.created_at).toISOString() });

  async function lastEntry() {
    const res = await call('?select=id,entry_hash&order=id.desc&limit=1');
    if (!res.ok) throw new Error(`supabase read failed (${res.status})`);
    const rows = await res.json();
    return rows[0] || null;
  }

  return {
    kind: 'supabase',

    async append({ prompt_hash, redaction_categories }) {
      for (let attempt = 0; attempt < MAX_APPEND_TRIES; attempt++) {
        const last = await lastEntry();
        const entry = buildEntry({
          prev_hash: last ? last.entry_hash : GENESIS,
          created_at: new Date(),
          prompt_hash,
          redaction_categories,
        });
        const res = await call('', {
          method: 'POST',
          headers: { Prefer: 'return=representation' },
          body: JSON.stringify(entry),
        });
        if (res.status === 409) continue; // another writer took this slot; re-read and retry
        if (!res.ok) throw new Error(`supabase insert failed (${res.status})`);
        const [row] = await res.json();
        return normalize(row);
      }
      throw new Error('supabase insert failed (chain contention)');
    },

    async all() {
      const out = [];
      for (let offset = 0; ; offset += PAGE) {
        const res = await call(`?select=*&order=id.asc&limit=${PAGE}&offset=${offset}`);
        if (!res.ok) throw new Error(`supabase read failed (${res.status})`);
        const rows = await res.json();
        out.push(...rows.map(normalize));
        if (rows.length < PAGE) return out;
      }
    },

    async recent(n) {
      const res = await call(`?select=*&order=id.desc&limit=${n}`);
      if (!res.ok) throw new Error(`supabase read failed (${res.status})`);
      return (await res.json()).map(normalize).reverse();
    },
  };
}
