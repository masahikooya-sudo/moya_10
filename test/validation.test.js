const test = require('node:test');
const assert = require('node:assert');
const v = require('../gas/webapp/Validation.gs');

const ctx = {
  applicant: 'taro@example.co.jp',
  internalDomain: 'example.co.jp',
  clients: [
    { name: 'ABC商事', domains: ['abc-shoji.co.jp'] },
    { name: 'XYZ工業', domains: ['xyz-kogyo.jp', 'xyz.co.jp'] }
  ],
  approvers: ['boss@example.co.jp']
};

function input(over) {
  return Object.assign({
    company: 'ABC商事',
    to: 'yamada@abc-shoji.co.jp',
    cc: '',
    subject: '見積書送付の件',
    body: 'ABC商事 山田様\n\nお世話になっております。',
    purpose: '見積書の送付',
    approver: 'boss@example.co.jp',
    expiryDays: 7,
    files: [{ name: '見積書.pdf', size: 1000 }]
  }, over);
}

test('正常な申請はエラーなし', () => {
  const r = v.validateRequest(input(), ctx);
  assert.deepStrictEqual(r.errors, []);
  assert.deepStrictEqual(r.warnings, []);
  assert.deepStrictEqual(r.to, ['yamada@abc-shoji.co.jp']);
});

test('宛先の区切り・大文字・重複を正規化する', () => {
  assert.deepStrictEqual(
    v.parseAddressList('A@x.jp; b@x.jp\n a@X.jp ,c@x.jp'),
    ['a@x.jp', 'b@x.jp', 'c@x.jp']
  );
});

test('取引先の登録ドメイン以外はエラー', () => {
  const r = v.validateRequest(input({ to: 'someone@other.co.jp' }), ctx);
  assert.match(r.errors.join(), /登録ドメインではありません/);
});

test('タイプミスのドメインには候補を提示する', () => {
  const r = v.validateRequest(input({ to: 'yamada@abc-shoj.co.jp' }), ctx);
  assert.match(r.errors.join(), /abc-shoji\.co\.jp」の入力ミス/);
});

test('別の取引先のドメインはその旨を表示する', () => {
  const r = v.validateRequest(input({ to: 'sato@xyz-kogyo.jp' }), ctx);
  assert.match(r.errors.join(), /別の取引先「XYZ工業」/);
});

test('Cc に社内アドレスは可、To に社内は警告', () => {
  assert.deepStrictEqual(v.validateRequest(input({ cc: 'hanako@example.co.jp' }), ctx).errors, []);
  const r = v.validateRequest(input({ to: 'yamada@abc-shoji.co.jp, hanako@example.co.jp' }), ctx);
  assert.deepStrictEqual(r.errors, []);
  assert.match(r.warnings.join(), /To に社内アドレス/);
});

test('自己承認・マスタ外の承認者はエラー', () => {
  assert.match(v.validateRequest(input({ approver: 'taro@example.co.jp' }), ctx).errors.join(), /自分自身/);
  assert.match(v.validateRequest(input({ approver: 'x@example.co.jp' }), ctx).errors.join(), /承認者マスタ/);
});

test('本文にパスワードを書くとエラー', () => {
  const r = v.validateRequest(input({ body: '本文\nパスワード：abc123' }), ctx);
  assert.match(r.errors.join(), /パスワードを書かない/);
});

test('ファイル名・本文に別の取引先名があれば警告', () => {
  const r = v.validateRequest(input({ files: [{ name: 'XYZ工業様_見積書.pdf', size: 10 }] }), ctx);
  assert.match(r.warnings.join(), /ファイル名に別の取引先名「XYZ工業」/);
  const r2 = v.validateRequest(input({ body: 'XYZ工業 佐藤様' }), ctx);
  assert.match(r2.warnings.join(), /件名または本文に別の取引先名/);
});

test('ファイル・件数・期限の制限', () => {
  assert.match(v.validateRequest(input({ files: [] }), ctx).errors.join(), /ファイルを選択/);
  assert.match(v.validateRequest(input({ files: [{ name: 'a.exe', size: 1 }] }), ctx).errors.join(), /送付できない種類/);
  assert.match(v.validateRequest(input({ files: [{ name: 'a.pdf', size: 31 * 1024 * 1024 }] }), ctx).errors.join(), /30MB/);
  assert.match(v.validateRequest(input({ expiryDays: 30 }), ctx).errors.join(), /有効期限/);
  const many = Array.from({ length: 11 }, (_, i) => `u${i}@abc-shoji.co.jp`).join(',');
  assert.match(v.validateRequest(input({ to: many }), ctx).errors.join(), /10 件まで/);
});

test('フリーメールは警告（取引先に登録されていても）', () => {
  const c = { ...ctx, clients: [{ name: '個人A', domains: ['gmail.com'] }] };
  const r = v.validateRequest(input({ company: '個人A', to: 'a@gmail.com', body: 'x' }), c);
  assert.deepStrictEqual(r.errors, []);
  assert.match(r.warnings.join(), /フリーメール/);
});
