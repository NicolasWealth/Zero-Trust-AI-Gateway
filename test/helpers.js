import { createApp } from '../app.js';

export async function startApp(options = {}) {
  const app = createApp(options);
  const server = await new Promise((resolve) => {
    const s = app.listen(0, '127.0.0.1', () => resolve(s));
  });
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  return {
    baseUrl,
    close: () => new Promise((resolve) => server.close(resolve)),
    post: (prompt) =>
      fetch(`${baseUrl}/ask-ai`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ prompt }),
      }),
  };
}

// Capture console output while fn runs, so tests can assert nothing sensitive was printed.
export async function captureConsole(fn) {
  const lines = [];
  const orig = { log: console.log, error: console.error, warn: console.warn, info: console.info };
  for (const k of Object.keys(orig)) console[k] = (...a) => lines.push(a.map(String).join(' '));
  try { await fn(); } finally { Object.assign(console, orig); }
  return lines.join('\n');
}
