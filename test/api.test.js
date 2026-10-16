import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { startApp, captureConsole } from './helpers.js';
import { createMemoryStore, sha256 } from '../audit.js';

test('rejects a missing prompt with 400', async () => {
  const t = await startApp();
  try {
    const res = await fetch(`${t.baseUrl}/ask-ai`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /prompt is required/);
  } finally { await t.close(); }
});

test('rejects a non-string prompt with 400', async () => {
  const t = await startApp();
  try {
    for (const bad of [123, null, ['a'], { a: 1 }, true]) {
      const res = await t.post(bad);
      assert.equal(res.status, 400, JSON.stringify(bad));
    }
  } finally { await t.close(); }
});

test('rejects an empty prompt with 400', async () => {
  const t = await startApp();
  try { assert.equal((await t.post('   ')).status, 400); } finally { await t.close(); }
});

test('rejects a prompt over 4000 characters, accepts exactly 4000', async () => {
  const t = await startApp();
  try {
    const over = await t.post('a'.repeat(4001));
    assert.equal(over.status, 400);
    assert.match((await over.json()).error, /4000/);
    assert.equal((await t.post('a'.repeat(4000))).status, 200);
  } finally { await t.close(); }
});

test('rejects malformed JSON with a JSON 400', async () => {
  const t = await startApp();
  try {
    const res = await fetch(`${t.baseUrl}/ask-ai`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{bad' });
    assert.equal(res.status, 400);
    assert.match((await res.json()).error, /not valid JSON/);
  } finally { await t.close(); }
});

test('demo mode returns the redacted prompt and the demo note, no model call', async () => {
  let called = false;
  const t = await startApp({ demoMode: true, fetchImpl: async () => { called = true; } });
  try {
    const res = await t.post('mail jane@example.com password: hunter22');
    const body = await res.json();
    assert.equal(res.status, 200);
    assert.equal(body.demo_mode, true);
    assert.equal(body.note, 'demo mode, no model call');
    assert.equal(body.redacted_prompt, 'mail [EMAIL] [CREDENTIAL]');
    assert.deepEqual(body.redactions.categories, { EMAIL: 1, CREDENTIAL: 1 });
    assert.equal(called, false);
    assert.ok(!JSON.stringify(body).includes('jane@example.com'));
  } finally { await t.close(); }
});

test('original prompt is never printed or stored', async () => {
  const store = createMemoryStore();
  const t = await startApp({ store });
  const secret = 'jane@example.com';
  try {
    const out = await captureConsole(async () => { await t.post(`mail ${secret} api_key=SUPERSECRET123`); });
    assert.ok(!out.includes(secret) && !out.includes('SUPERSECRET123'));
    const stored = JSON.stringify(await store.all());
    assert.ok(!stored.includes(secret) && !stored.includes('SUPERSECRET123'));
    const [entry] = await store.all();
    assert.equal(entry.prompt_hash, sha256('mail [EMAIL] [CREDENTIAL]'));
    assert.deepEqual(entry.redaction_categories, { CREDENTIAL: 1, EMAIL: 1 });
  } finally { await t.close(); }
});

test('DEMO_MODE=false without OPENAI_API_KEY returns 503', async () => {
  const t = await startApp({ demoMode: false, openaiKey: '' });
  try { assert.equal((await t.post('hello')).status, 503); } finally { await t.close(); }
});

test('DEMO_MODE=false with a key sends only the cleaned prompt to the model', async () => {
  let sent;
  const fetchImpl = async (url, init) => {
    sent = { url, body: JSON.parse(init.body), auth: init.headers.Authorization };
    return new Response(JSON.stringify({ choices: [{ message: { content: 'hi' } }] }), { status: 200 });
  };
  const t = await startApp({ demoMode: false, openaiKey: 'test-key', fetchImpl });
  try {
    const body = await (await t.post('mail jane@example.com')).json();
    assert.equal(body.ai_answer, 'hi');
    assert.equal(sent.url, 'https://api.openai.com/v1/chat/completions');
    assert.equal(sent.body.messages[0].content, 'mail [EMAIL]');
    assert.equal(sent.auth, 'Bearer test-key');
  } finally { await t.close(); }
});

test('nothing is forwarded if the audit log cannot be written', async () => {
  let called = false;
  const store = { kind: 'broken', append: async () => { throw new Error('db down'); } };
  const t = await startApp({ demoMode: false, openaiKey: 'k', store, fetchImpl: async () => { called = true; } });
  try {
    let res;
    await captureConsole(async () => { res = await t.post('hello'); });
    assert.equal(res.status, 503);
    assert.equal(called, false);
  } finally { await t.close(); }
});

test('rate limit: requests 1-10 pass, the 11th returns 429', async () => {
  const t = await startApp();
  try {
    const statuses = [];
    for (let i = 0; i < 11; i++) statuses.push((await t.post('hello')).status);
    assert.deepEqual(statuses.slice(0, 10), Array(10).fill(200));
    assert.equal(statuses[10], 429);
  } finally { await t.close(); }
});

test('/audit/verify reports valid, then broken after an entry is edited', async () => {
  const store = createMemoryStore();
  const t = await startApp({ store, rateLimitOptions: { windowMs: 60000, limit: 100 } });
  try {
    for (let i = 0; i < 4; i++) await t.post(`note ${i} a${i}@example.com`);
    let v = await (await fetch(`${t.baseUrl}/audit/verify`)).json();
    assert.deepEqual(v, { valid: true, brokenAtId: null, checked: 4 });
    store._rows[1].redaction_categories = { EMAIL: 5 };
    v = await (await fetch(`${t.baseUrl}/audit/verify`)).json();
    assert.equal(v.valid, false);
    assert.equal(v.brokenAtId, 2);
  } finally { await t.close(); }
});

test('/audit/simulate-tamper leaves the real log untouched', async () => {
  const store = createMemoryStore();
  const t = await startApp({ store, rateLimitOptions: { windowMs: 60000, limit: 100 } });
  try {
    for (let i = 0; i < 5; i++) await t.post(`note ${i}`);
    const before = JSON.stringify(await store.all());
    const sim = await (await fetch(`${t.baseUrl}/audit/simulate-tamper`)).json();
    assert.equal(sim.after.valid, false);
    assert.equal(JSON.stringify(await store.all()), before);
    assert.equal((await (await fetch(`${t.baseUrl}/audit/verify`)).json()).valid, true);
  } finally { await t.close(); }
});

test('only public/ is served, not source files or db.json', async () => {
  const t = await startApp();
  try {
    for (const p of ['/server.js', '/package.json', '/db.json', '/redact.js', '/.env']) {
      assert.equal((await fetch(`${t.baseUrl}${p}`)).status, 404, p);
    }
    assert.equal((await fetch(`${t.baseUrl}/`)).status, 200);
  } finally { await t.close(); }
});

test('responses carry helmet headers, including on static files', async () => {
  const t = await startApp();
  try {
    const res = await fetch(`${t.baseUrl}/`);
    assert.ok(res.headers.get('content-security-policy'));
    assert.equal(res.headers.get('x-content-type-options'), 'nosniff');
  } finally { await t.close(); }
});

test('no Supabase key or URL appears in files served to the browser', () => {
  for (const f of fs.readdirSync('public')) {
    const text = fs.readFileSync(`public/${f}`, 'utf8').toLowerCase();
    assert.ok(!text.includes('service_key') && !text.includes('supabase') && !text.includes('sb_secret'), f);
  }
});
