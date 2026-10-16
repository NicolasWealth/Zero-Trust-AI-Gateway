import express from 'express';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { redactPrompt } from './redact.js';
import { sha256, createMemoryStore, verifyChain, simulateTamper } from './audit.js';
import { createSupabaseStore } from './supabase-store.js';

const PUBLIC_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'public');
export const MAX_PROMPT_CHARS = 4000;

export function createApp({
  store = createMemoryStore(),
  demoMode = true,
  openaiKey = '',
  trustProxy = false,
  rateLimitOptions = { windowMs: 15 * 60 * 1000, limit: 10 },
  fetchImpl = fetch,
} = {}) {
  const app = express();
  if (trustProxy) app.set('trust proxy', 1);
  app.disable('x-powered-by');
  app.use(helmet());                       // before static files so every response gets the headers
  app.use(express.json({ limit: '16kb' })); // no request body is ever logged
  app.use(express.static(PUBLIC_DIR));      // only ./public, never the repo root

  app.get('/health', (req, res) => {
    res.json({ status: 'ok', demo_mode: demoMode, audit_store: store.kind });
  });

  const askLimiter = rateLimit({
    ...rateLimitOptions,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Too many requests. Try again later.' },
  });

  app.post('/ask-ai', askLimiter, async (req, res) => {
    const prompt = req.body?.prompt;
    if (typeof prompt !== 'string') {
      return res.status(400).json({ error: 'prompt is required and must be a string' });
    }
    if (prompt.trim().length === 0) {
      return res.status(400).json({ error: 'prompt must not be empty' });
    }
    if (prompt.length > MAX_PROMPT_CHARS) {
      return res.status(400).json({ error: `prompt must be ${MAX_PROMPT_CHARS} characters or fewer` });
    }
    if (!demoMode && !openaiKey) {
      return res.status(503).json({ error: 'DEMO_MODE is false but OPENAI_API_KEY is not set' });
    }

    const { cleaned, categories, total } = redactPrompt(prompt);

    // Audit first. If the log cannot be written, nothing is forwarded.
    let entry;
    try {
      entry = await store.append({ prompt_hash: sha256(cleaned), redaction_categories: categories });
    } catch (err) {
      console.error('audit append failed:', err.message);
      return res.status(503).json({ error: 'audit log unavailable; request not processed' });
    }

    const base = {
      status: 'ok',
      redacted_prompt: cleaned,
      redactions: { categories, total },
      audit_id: entry.id,
    };

    if (demoMode) {
      return res.json({ ...base, demo_mode: true, note: 'demo mode, no model call' });
    }

    try {
      const r = await fetchImpl('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${openaiKey}` },
        body: JSON.stringify({ model: 'gpt-4o-mini', messages: [{ role: 'user', content: cleaned }] }),
        signal: AbortSignal.timeout(30000),
      });
      if (!r.ok) return res.status(502).json({ error: 'model request failed', upstream_status: r.status });
      const data = await r.json();
      return res.json({ ...base, demo_mode: false, ai_answer: data.choices?.[0]?.message?.content ?? '' });
    } catch (err) {
      console.error('model call failed:', err.name);
      return res.status(502).json({ error: 'model request failed' });
    }
  });


  // ---- Audit log ----
  const auditLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 60,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Too many requests. Try again later.' },
  });
  const unavailable = (res, err) => {
    console.error('audit read failed:', err.message);
    return res.status(503).json({ error: 'audit log unavailable' });
  };

  app.get('/audit/verify', auditLimiter, async (req, res) => {
    try {
      res.json(verifyChain(await store.all()));
    } catch (err) {
      unavailable(res, err);
    }
  });

  app.get('/audit/recent', auditLimiter, async (req, res) => {
    try {
      const rows = await store.recent(10);
      res.json(rows.map(({ id, created_at, redaction_categories, prompt_hash, entry_hash }) => (
        { id, created_at, redaction_categories, prompt_hash, entry_hash }
      )));
    } catch (err) {
      unavailable(res, err);
    }
  });

  app.get('/audit/simulate-tamper', auditLimiter, async (req, res) => {
    try {
      res.json(simulateTamper(await store.recent(20)));
    } catch (err) {
      unavailable(res, err);
    }
  });

  // JSON errors only. Never echo the request body.
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') return res.status(400).json({ error: 'request body is not valid JSON' });
    if (err.type === 'entity.too.large') return res.status(413).json({ error: 'request body too large' });
    console.error('unhandled error:', err.message);
    res.status(500).json({ error: 'internal error' });
  });

  return app;
}

export function createAppFromEnv(env = process.env) {
  const store = env.SUPABASE_URL && env.SUPABASE_SERVICE_KEY
    ? createSupabaseStore({ url: env.SUPABASE_URL, serviceKey: env.SUPABASE_SERVICE_KEY })
    : createMemoryStore();
  return createApp({
    store,
    demoMode: (env.DEMO_MODE ?? 'true').toLowerCase() !== 'false',
    openaiKey: env.OPENAI_API_KEY || '',
    trustProxy: Boolean(env.VERCEL) || env.TRUST_PROXY === 'true',
  });
}
