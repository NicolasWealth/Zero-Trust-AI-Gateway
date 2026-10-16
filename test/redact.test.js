import { test } from 'node:test';
import assert from 'node:assert/strict';
import { redactPrompt } from '../redact.js';

test('redacts an email address', () => {
  const r = redactPrompt('Write to jane.doe@example.com today');
  assert.equal(r.cleaned, 'Write to [EMAIL] today');
  assert.deepEqual(r.categories, { EMAIL: 1 });
});

test('redacts phone numbers (US, international, Nigerian local)', () => {
  assert.match(redactPrompt('call 415-555-0132').cleaned, /\[PHONE\]/);
  assert.match(redactPrompt('call +234 803 123 4567').cleaned, /\[PHONE\]/);
  assert.match(redactPrompt('call 08031234567').cleaned, /\[PHONE\]/);
});

test('redacts a Luhn-valid card number, leaves a non-Luhn number alone', () => {
  assert.equal(redactPrompt('card 4111 1111 1111 1111').cleaned, 'card [CREDIT_CARD]');
  assert.equal(redactPrompt('id 1234567890123456').cleaned, 'id 1234567890123456');
});

test('redacts "password: x"', () => {
  const r = redactPrompt('login password: hunter22 now');
  assert.ok(!r.cleaned.includes('hunter22'));
  assert.deepEqual(r.categories, { CREDENTIAL: 1 });
});

test('redacts "api_key=x" and SECRET_KEY = x', () => {
  const r = redactPrompt('api_key=abcd1234efgh and SECRET_KEY = xyz98765');
  assert.ok(!r.cleaned.includes('abcd1234efgh'));
  assert.ok(!r.cleaned.includes('xyz98765'));
  assert.equal(r.categories.CREDENTIAL, 2);
});

test('redacts Bearer tokens once', () => {
  const r = redactPrompt('Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.abc.def');
  assert.ok(!r.cleaned.includes('eyJhbGci'));
  assert.equal(r.categories.CREDENTIAL, 1);
});

test('redacts sk- style keys', () => {
  for (const key of ['sk-998877', 'sk-proj-abc123DEF456ghi']) {
    const r = redactPrompt(`my key is ${key}`);
    assert.ok(!r.cleaned.includes(key), key);
  }
});

test('redacts AWS access key id and secret access key', () => {
  const r = redactPrompt('AKIAIOSFODNN7EXAMPLE and aws_secret_access_key=wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY');
  assert.ok(!r.cleaned.includes('AKIA'));
  assert.ok(!r.cleaned.includes('wJalrXUtnFEMI'));
  assert.equal(r.categories.CREDENTIAL, 2);
});

test('redacts "password is x"', () => {
  assert.ok(!redactPrompt('my password is hunter2').cleaned.includes('hunter2'));
});

test('clean text stays unchanged', () => {
  for (const t of [
    'Explain how TCP works to a beginner.',
    'Summarize the meeting notes about the project deadline.',
    'Order number 12345, version 2.4.1 ships in 2026.',
    'The token bucket algorithm limits request rates.',
  ]) {
    const r = redactPrompt(t);
    assert.equal(r.cleaned, t);
    assert.deepEqual(r.categories, {});
    assert.equal(r.total, 0);
  }
});

test('repeated calls give the same result (no global regex lastIndex bug)', () => {
  const results = Array.from({ length: 5 }, () => redactPrompt('password: abcd1234').cleaned);
  assert.deepEqual(new Set(results).size, 1);
  assert.equal(results[0], '[CREDENTIAL]');
});

test('rejects non-string input', () => {
  assert.throws(() => redactPrompt(42), TypeError);
});
