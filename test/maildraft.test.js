const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const m = require('../gas/api/MailBody.gs');

const URL = 'https://example.primedrive.jp/s/abc';

test('{{URL}} と {{有効期限}} を差し込む', () => {
  const body = m.renderMailBody('こちらから：{{URL}}\n期限：{{有効期限}}', URL, '2026年10月27日 18:00');
  assert.strictEqual(body, `こちらから：${URL}\n期限：2026年10月27日 18:00`);
});

test('{{URL}} が無ければ末尾に追記する', () => {
  const body = m.renderMailBody('本文です。\n\n', URL, '期限X');
  assert.ok(body.startsWith('本文です。\n\n■ダウンロードURL\n' + URL));
  assert.match(body, /パスワードは別メール/);
});

test('パスワードメールにパスワードと期限が入る', () => {
  const p = m.renderPasswordMail('見積書送付の件', 'ABC商事', 'Pw#12345abcd', '期限X');
  assert.strictEqual(p.subject, '【パスワードのお知らせ】見積書送付の件');
  assert.match(p.body, /Pw#12345abcd/);
  assert.match(p.body, /期限X/);
});

test('パスワードは指定長で全文字種を含み、紛らわしい文字を含まない', () => {
  for (let i = 0; i < 500; i++) {
    const pw = m.generatePassword(12, () => Array.from(crypto.randomBytes(52)));
    assert.strictEqual(pw.length, 12);
    m.PASSWORD_CHARSETS.forEach((set) => assert.ok([...pw].some((ch) => set.includes(ch)), pw));
    assert.doesNotMatch(pw, /[0O1lI]/);
  }
});
