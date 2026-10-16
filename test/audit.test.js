import { test } from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { GENESIS, sha256, computeEntryHash, verifyChain, simulateTamper, createMemoryStore, canonicalCategories } from '../audit.js';

async function makeChain(n = 5) {
  const store = createMemoryStore();
  for (let i = 1; i <= n; i++) {
    await store.append({ prompt_hash: sha256(`prompt ${i}`), redaction_categories: { EMAIL: i } });
  }
  return store;
}

test('entry_hash follows the documented formula', async () => {
  const store = await makeChain(1);
  const [e] = await store.all();
  const expected = crypto.createHash('sha256')
    .update(GENESIS + e.created_at + e.prompt_hash + JSON.stringify(e.redaction_categories))
    .digest('hex');
  assert.equal(e.entry_hash, expected);
  assert.equal(e.prev_hash, GENESIS);
});

test('each entry links to the one before it', async () => {
  const rows = await (await makeChain(4)).all();
  for (let i = 1; i < rows.length; i++) assert.equal(rows[i].prev_hash, rows[i - 1].entry_hash);
});

test('a fresh chain is valid', async () => {
  const rows = await (await makeChain(6)).all();
  assert.deepEqual(verifyChain(rows), { valid: true, brokenAtId: null, checked: 6 });
});

test('an empty log is valid', () => {
  assert.equal(verifyChain([]).valid, true);
});

test('editing one entry breaks the chain at that entry', async () => {
  const store = await makeChain(5);
  store._rows[2].prompt_hash = sha256('something else');
  const r = verifyChain(await store.all());
  assert.equal(r.valid, false);
  assert.equal(r.brokenAtId, 3);
});

test('editing the categories of an entry is detected', async () => {
  const store = await makeChain(4);
  store._rows[1].redaction_categories = { EMAIL: 99 };
  assert.deepEqual(verifyChain(await store.all()), { valid: false, brokenAtId: 2, checked: 2 });
});

test('deleting a middle entry is detected', async () => {
  const rows = await (await makeChain(5)).all();
  rows.splice(2, 1);
  const r = verifyChain(rows);
  assert.equal(r.valid, false);
  assert.equal(r.brokenAtId, 4);
});

test('category key order does not change the hash (jsonb safe)', () => {
  assert.equal(canonicalCategories({ B: 1, A: 2 }), canonicalCategories({ A: 2, B: 1 }));
  const base = { prev_hash: GENESIS, created_at: '2026-01-01T00:00:00.000Z', prompt_hash: 'x' };
  assert.equal(
    computeEntryHash({ ...base, redaction_categories: { B: 1, A: 2 } }),
    computeEntryHash({ ...base, redaction_categories: { A: 2, B: 1 } }),
  );
});

test('simulateTamper detects the edit and does not change the input rows', async () => {
  const rows = await (await makeChain(6)).all();
  const snapshot = JSON.stringify(rows);
  const r = simulateTamper(rows);
  assert.equal(r.before.valid, true);
  assert.equal(r.after.valid, false);
  assert.equal(r.after.brokenAtId, r.tamperedId);
  assert.match(r.source, /copy of the last 6 real entries/);
  assert.equal(JSON.stringify(rows), snapshot);
});

test('simulateTamper uses a synthetic sample when the log is nearly empty', () => {
  const r = simulateTamper([]);
  assert.match(r.source, /synthetic/);
  assert.equal(r.before.valid, true);
  assert.equal(r.after.valid, false);
});
