const test = require('node:test');
const assert = require('node:assert');

const load = () => import('../robot/src/issueResult.js');

test('発行結果画面の表示内容を解析する', async () => {
  const { parseIssueResult } = await load();
  const r = parseIssueResult('対象名: 20261026-091500-AB12 (19B)\nダウンロードリンク: https://primedrive.jp/v2/access?key=XYzAkIR8BvN3yI5-NguZmg\n有効期限: 2026/11/02 09:16\nダウンロード回数: 30\n');
  assert.deepStrictEqual(r, {
    targetName: '20261026-091500-AB12',
    url: 'https://primedrive.jp/v2/access?key=XYzAkIR8BvN3yI5-NguZmg',
    expiresAt: '2026-11-02T09:16:00+09:00',
    downloadCount: 30
  });
});

test('URL や有効期限が読めなければエラー', async () => {
  const { parseIssueResult } = await load();
  assert.throws(() => parseIssueResult('対象名: a\n有効期限: 2026/11/02 09:16'), /ダウンロードリンク/);
  assert.throws(() => parseIssueResult('ダウンロードリンク: https://x/y'), /有効期限/);
});

test('有効期限が指定日数と違えばエラー', async () => {
  const { checkExpiry } = await load();
  const now = new Date('2026-10-26T09:16:00+09:00');
  checkExpiry('2026-11-02T09:16:00+09:00', 7, now);
  assert.throws(() => checkExpiry('2026-11-25T09:16:00+09:00', 7, now), /異なります/);
});

test('扱えないファイル名を拒否する', async () => {
  const { assertSafeFileName } = await load();
  assertSafeFileName('見積書 2026.pdf');
  for (const bad of ['a/b.pdf', '..', 'a:b', 'x.pdf ', '', 'a\u0001b']) {
    assert.throws(() => assertSafeFileName(bad), /扱えない/, bad);
  }
});
