#  Zero-Trust AI Gateway

A lightweight, security-first Node.js proxy that sits between your application and the OpenAI API. It automatically strips sensitive data from prompts before they ever leave your infrastructure — so you can use AI safely, even with internal tooling.

---

## How It Works

```
Your App  →  [PII Redactor]  →  [Credential Shield]  →  [Audit Log]  →  OpenAI API
```

Every incoming prompt is passed through two sanitization layers before being forwarded to OpenAI:

1. **PII Redactor** — uses `pii-redact` to detect and strip personally identifiable information (names, emails, phone numbers, etc.)
2. **Custom Credential Shield** — regex-based filter that blocks secrets like `password: abc123` or `Authorization: Bearer xyz`

Both the original and redacted versions are logged locally via `lowdb` for auditing. Only the clean, redacted prompt is ever sent to OpenAI.

---

## Features

- 🔒 Automatic PII redaction on every request
- 🔑 Blocks credentials, tokens, and secrets from leaking into prompts
- 📋 Local audit log (`db.json`) tracking all requests and whether redaction occurred
- 🪖 HTTP security headers via `helmet`
- 🔁 Automated dependency vulnerability scanning via GitHub Actions (`npm audit` on every push)

---

## Tech Stack

| Package | Purpose |
|---|---|
| `express` v5 | HTTP server & routing |
| `helmet` | Secure HTTP response headers |
| `pii-redact` | PII detection and redaction |
| `axios` | Forwarding requests to OpenAI |
| `lowdb` | Lightweight local JSON audit log |
| `dotenv` | Environment variable management |

---

## Getting Started

### Prerequisites

- Node.js >= 18
- An OpenAI API key

### Installation

```bash
git clone https://github.com/NicolasWealth/Zero-Trust-AI-Gateway.git
cd Zero-Trust-AI-Gateway
npm install
```

### Configuration

Create a `.env` file in the project root:

```env
OPENAI_API_KEY=your_openai_api_key_here
```

> ⚠️ `.env` is listed in `.gitignore` — never commit your API key.

### Running the Server

```bash
node server.js
```

The gateway will start at `http://localhost:3000`.

---

## API Usage

### `POST /ask-ai`

Send a prompt to the gateway. PII and credentials are automatically redacted before the request reaches OpenAI.

**Request**

```json
{
  "prompt": "My name is John Smith and my email is john@example.com. Summarize this for me."
}
```

**Response**

```json
{
  "status": "Success",
  "redacted_version": "My name is [PERSON] and my email is [EMAIL]. Summarize this for me.",
  "ai_answer": "..."
}
```

---

## Audit Log

Every request is appended to `db.json` with the following structure:

```json
{
  "logs": [
    {
      "timestamp": "2025-03-31T10:00:00.000Z",
      "original": "My password is abc123",
      "was_redacted": true
    }
  ]
}
```

This gives you a full local record of what was received and whether sensitive data was detected — without storing the redacted output.

---

## Security Pipeline

A GitHub Actions workflow (`.github/workflows/security.yml`) runs `npm audit` on every push to catch known vulnerabilities in project dependencies automatically.

---

## Project Structure

```
Zero-Trust-AI-Gateway/
├── server.js                        # Main gateway server
├── package.json
├── .env                             # Your secrets (not committed)
├── db.json                          # Auto-generated audit log
└── .github/
    └── workflows/
        └── security.yml             # Automated dependency scanning
```

---

## License

ISC
