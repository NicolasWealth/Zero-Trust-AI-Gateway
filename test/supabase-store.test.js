import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSupabaseStore } from '../supabase-store.js';
import { verifyChain, sha256 } from '../audit.js';

// A small fake of the PostgREST endpoints the store uses. This tests the store's
// logic (hash linking, 409 retry, paging, headers). It is not a live Supabase test.
function fakePostgrest({ conflictFirstInsert = false } = {}) {
  const rows = [];
  const seen = [];
  let conflicts = conflictFirstInsert ? 1 : 0;
  const fetchImpl = async (url, init = {}) => {
    seen.push({ url, init });
    const u = new URL(url);
    if ((init.method || 'GET') === 'POST') {
      if (conflicts > 0) { conflicts--; return new Response('{}', { status: 409 }); }
      const row = JSON.parse(init.body);
      if (rows.some((r) => r.prev_hash === row.prev_hash || r.entry_hash === row.entry_hash)) {
        return new Response('{}', { status: 409 });
      }
      const saved = { id: rows.length + 1, ...row, created_at: row.created_at.replace('Z', '+00:00') };
      rows.push(saved);
      return new Response(JSON.stringify([saved]), { status: 201 });
    }
    const desc = u.searchParams.get('order') === 'id.desc';
    const limit = Number(u.searchParams.get('limit'));
    const offset = Number(u.searchParams.get('offset') || 0);
    const sorted = desc ? [...rows].reverse() : rows;
    return new Response(JSON.stringify(sorted.slice(offset, offset + limit)), { status: 200 });
  };
  return { fetchImpl, rows, seen };
}

test('append builds a valid chain and survives timestamp reformatting', async () => {
  const fake = fakePostgrest();
  const store = createSupabaseStore({ url: 'https://x.supabase.co', serviceKey: 'a.b.c', fetchImpl: fake.fetchImpl });
  for (let i = 0; i < 5; i++) await store.append({ prompt_hash: sha256(`p${i}`), redaction_categories: { EMAIL: i } });
  assert.equal(verifyChain(await store.all()).valid, true);
});

test('append retries after a 409 and still links correctly', async () => {
  const fake = fakePostgrest({ conflictFirstInsert: true });
  const store = createSupabaseStore({ url: 'https://x.supabase.co', serviceKey: 'a.b.c', fetchImpl: fake.fetchImpl });
  await store.append({ prompt_hash: sha256('a'), redaction_categories: {} });
  await store.append({ prompt_hash: sha256('b'), redaction_categories: {} });
  assert.equal(fake.rows.length, 2);
  assert.equal(verifyChain(await store.all()).valid, true);
});

test('all() pages through more than 1000 rows', async () => {
  const fake = fakePostgrest();
  const store = createSupabaseStore({ url: 'https://x.supabase.co', serviceKey: 'a.b.c', fetchImpl: fake.fetchImpl });
  for (let i = 0; i < 1203; i++) await store.append({ prompt_hash: sha256(`p${i}`), redaction_categories: {} });
  const all = await store.all();
  assert.equal(all.length, 1203);
  assert.equal(verifyChain(all).valid, true);
});

test('a database edit is caught after a round trip', async () => {
  const fake = fakePostgrest();
  const store = createSupabaseStore({ url: 'https://x.supabase.co', serviceKey: 'a.b.c', fetchImpl: fake.fetchImpl });
  for (let i = 0; i < 4; i++) await store.append({ prompt_hash: sha256(`p${i}`), redaction_categories: { EMAIL: 1 } });
  fake.rows[2].redaction_categories = { EMAIL: 7 };
  assert.equal(verifyChain(await store.all()).brokenAtId, 3);
});

test('JWT-style key goes in apikey and Authorization; sb_ key goes in apikey only', async () => {
  for (const [key, expectAuth] of [['aaa.bbb.ccc', true], ['sb_secret_abc', false]]) {
    const fake = fakePostgrest();
    const store = createSupabaseStore({ url: 'https://x.supabase.co/', serviceKey: key, fetchImpl: fake.fetchImpl });
    await store.append({ prompt_hash: 'h', redaction_categories: {} });
    const h = fake.seen[0].init.headers;
    assert.equal(h.apikey, key);
    assert.equal(Boolean(h.Authorization), expectAuth);
    assert.ok(fake.seen[0].url.startsWith('https://x.supabase.co/rest/v1/audit_log'));
  }
});

test('errors do not include response bodies or keys', async () => {
  const fetchImpl = async () => new Response('secret detail', { status: 500 });
  const store = createSupabaseStore({ url: 'https://x.supabase.co', serviceKey: 'topsecretkey', fetchImpl });
  await assert.rejects(() => store.append({ prompt_hash: 'h', redaction_categories: {} }), (e) => {
    assert.ok(!e.message.includes('topsecretkey') && !e.message.includes('secret detail'));
    return true;
  });
});
