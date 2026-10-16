# Zero Trust AI Gateway

A small Express service that removes emails, phone numbers, card numbers and common credential patterns from a prompt before it is sent to a model. Every request is recorded in a tamper-evident audit log. It addresses the sensitive information disclosure risk in the OWASP LLM Top 10. It does not cover the whole list.

Demo: (https://zero-trust-ai-gateway.vercel.app/) The public demo does not call a model.

## What it does

- Redacts PII (email, phone, card number with Luhn check, SSN, IPv4) and credentials (`password: x`, `api_key=x`, `Bearer <token>`, `sk-...` keys, AWS keys).
- Rejects a missing or non-string prompt, an empty prompt, and a prompt over 4000 characters (HTTP 400).
- Never stores or prints the original prompt. The log keeps a SHA-256 hash of the cleaned prompt and the redaction categories.
- Links log entries in a hash chain. `GET /audit/verify` walks it and returns `{ valid, brokenAtId }`.
- Rate limits `/ask-ai` to 10 requests per 15 minutes per IP.
- Runs in demo mode by default (no model call). With `DEMO_MODE=false` and `OPENAI_API_KEY` set, the cleaned prompt goes to `gpt-4o-mini`.

## Architecture

```
Browser / client
      |
      v
  POST /ask-ai
      |
  [helmet] -> [rate limit] -> [input check]
      |
  [redact.js: credentials, then PII]
      |
  [audit log: hash of cleaned prompt + categories, linked to previous entry]
      |            (Supabase table audit_log, or memory if Supabase is not set)
      v
  DEMO_MODE=true : return cleaned prompt, "demo mode, no model call"
  DEMO_MODE=false: send cleaned prompt to OpenAI, return the answer

  GET /audit/verify           walk the chain
  GET /audit/simulate-tamper  edit a COPY in memory, show the break
  GET /audit/recent           last 10 entries (hashes and categories only)
```

Log entry: `entry_hash = SHA-256(prev_hash + created_at + prompt_hash + categories)`.

## Run locally

```bash
git clone https://github.com/NicolasWealth/Zero-Trust-AI-Gateway.git
cd Zero-Trust-AI-Gateway
npm ci
cp .env.example .env     # defaults to demo mode, in-memory log
npm start                # http://localhost:3000
```

For a persistent log, create the table with `supabase/audit_log.sql` and set `SUPABASE_URL` and `SUPABASE_SERVICE_KEY` in `.env`. The service key stays on the server. It is never sent to the browser.

## Run with Docker

```bash
docker build -t zero-trust-ai-gateway .
docker run -p 3000:3000 --env-file .env zero-trust-ai-gateway
```

## Test

```bash
npm test
```

Uses Node's built-in test runner. No extra dependencies.

## Deploy

Vercel: `api/index.js` is the serverless entry and `vercel.json` routes requests to it. Set `SUPABASE_URL`, `SUPABASE_SERVICE_KEY` and `DEMO_MODE=true`.

## Limitations

- Detection uses patterns. It misses unusual formats, spelled-out numbers and anything it has no pattern for.
- It does not detect personal names, street addresses or free-text secrets without a keyword.
- Keyword rules can over-redact (for example `token: abcd` in a harmless sentence).
- It is not a complete answer to prompt injection.
- The rate limiter is in memory. On Vercel each instance has its own counter, so the real limit is looser than 10 per 15 minutes.
- The hash chain detects edits and deleted middle entries. It does not detect deletion of the newest entries. Someone with write access to the database can rebuild the whole chain. Anchoring the latest hash somewhere else would reduce that.
- A hash of a short, guessable cleaned prompt can be guessed by brute force.
- Anyone can add entries to the public demo log, within the rate limit.
- The demo does not call a model.
- Without Supabase settings the log is in memory and resets on restart.
- Supabase and Vercel paths were tested against fakes and a local simulation, not live services, until you deploy.

## License

ISC
