const $ = (id) => document.getElementById(id);
const promptEl = $('prompt');

function updateCount() { $('count').textContent = `${promptEl.value.length} / 4000`; }
promptEl.addEventListener('input', updateCount);
updateCount();

$('send').addEventListener('click', async () => {
  const btn = $('send');
  $('error').hidden = true;
  btn.disabled = true;
  try {
    const res = await fetch('/ask-ai', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ prompt: promptEl.value }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
    $('cleaned').textContent = data.redacted_prompt;
    const cats = data.redactions.categories;
    $('categories').textContent = Object.keys(cats).length
      ? Object.entries(cats).map(([k, v]) => `${k}: ${v}`).join('\n')
      : 'none';
    $('note').textContent = data.note || (data.ai_answer ? `Model answer: ${data.ai_answer}` : '');
    $('result').hidden = false;
  } catch (err) {
    $('error').textContent = err.message;
    $('error').hidden = false;
  } finally {
    btn.disabled = false;
  }
});

// ---- Audit log ----
async function getJson(path) {
  const res = await fetch(path);
  const data = await res.json();
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

function setStatus(el, text, cls) {
  el.textContent = text;
  el.className = cls ? `muted ${cls}` : 'muted';
}

function withButton(id, fn) {
  $(id).addEventListener('click', async () => {
    const btn = $(id);
    btn.disabled = true;
    try { await fn(); } finally { btn.disabled = false; }
  });
}

withButton('verify', async () => {
  const out = $('verifyOut');
  try {
    const r = await getJson('/audit/verify');
    setStatus(out, r.valid
      ? `Log is valid. ${r.checked} entries checked.`
      : `Log is BROKEN at entry id ${r.brokenAtId}.`, r.valid ? 'ok' : 'bad');
  } catch (err) { setStatus(out, err.message, 'bad'); }
});

withButton('tamper', async () => {
  const out = $('tamperOut');
  try {
    const r = await getJson('/audit/simulate-tamper');
    const before = r.before.valid ? 'valid' : `broken at id ${r.before.brokenAtId}`;
    const after = r.after.valid ? 'valid (not detected)' : `broken at id ${r.after.brokenAtId}`;
    setStatus(out,
      `Source: ${r.source}. Before the edit the chain is ${before}. ` +
      `Entry ${r.tamperedId} had its ${r.change.field} changed from ${r.change.before}... to ${r.change.after}... ` +
      `After the edit the chain is ${after}. ${r.note}`,
      r.after.valid ? 'bad' : 'ok');
  } catch (err) { setStatus(out, err.message, 'bad'); }
});

withButton('refresh', async () => {
  const box = $('recent');
  box.textContent = '';
  try {
    const rows = await getJson('/audit/recent');
    if (!rows.length) { box.textContent = 'No entries yet.'; return; }
    const table = document.createElement('table');
    const head = table.createTHead().insertRow();
    for (const h of ['id', 'time', 'categories', 'entry hash']) head.insertCell().textContent = h;
    const body = table.createTBody();
    for (const r of rows) {
      const tr = body.insertRow();
      tr.insertCell().textContent = r.id;
      tr.insertCell().textContent = r.created_at;
      tr.insertCell().textContent = JSON.stringify(r.redaction_categories);
      tr.insertCell().textContent = r.entry_hash.slice(0, 16) + '...';
    }
    box.appendChild(table);
  } catch (err) { box.textContent = err.message; }
});
