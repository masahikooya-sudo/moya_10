/**
 * 3 つの GAS プロジェクトを Google サービスのモックで動かし、
 * 申請 → 承認 → PAD 発行 → 下書き作成 の一連の流れを検証する。
 */
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function createWorld() {
  const sheets = {};
  const mails = [];
  const drafts = [];
  const folders = {};
  const world = { sheets, mails, drafts, folders, user: 'taro@example.co.jp' };

  function makeSheet() {
    const rows = [];
    return {
      rows,
      getLastRow: () => rows.length,
      appendRow: (r) => rows.push(r.map((x) => (typeof x === 'string' && x.startsWith("'") ? x.slice(1) : x))),
      setFrozenRows: () => {},
      getRange: (r, c, nr, nc) => ({
        getValues: () => rows.slice(r - 1, r - 1 + nr).map((row) => {
          const out = row.slice(c - 1, c - 1 + nc);
          while (out.length < nc) out.push('');
          return out;
        }),
        // スプレッドシート同様、先頭の ' は文字列指定として取り除いて保存する
        setValues: (vals) => vals.forEach((v, i) => {
          rows[r - 1 + i] = v.map((x) => (typeof x === 'string' && x.startsWith("'") ? x.slice(1) : x));
        })
      })
    };
  }
  const ss = {
    getSheetByName: (n) => sheets[n] || null,
    insertSheet: (n) => (sheets[n] = makeSheet())
  };
  const driveFiles = {};
  let folderSeq = 0;
  function makeFolder(id) {
    const f = {
      id, trashed: false, viewers: [], files: [],
      getId: () => id,
      createFolder: () => { const nf = makeFolder('folder' + ++folderSeq); folders[nf.id] = nf; return nf; },
      createFile: (blob) => {
        f.files.push(blob);
        const fileId = id + '-file' + f.files.length;
        driveFiles[fileId] = blob;
        return { getSize: () => blob.bytes.length, getId: () => fileId, getUrl: () => 'https://drive/' + blob.name };
      },
      addViewer: (e) => f.viewers.push(e),
      setTrashed: (t) => { f.trashed = t; }
    };
    return f;
  }
  folders.staging = makeFolder('staging');

  function services(props) {
    return {
      PropertiesService: { getScriptProperties: () => ({ getProperty: (k) => props[k] || null }) },
      SpreadsheetApp: { openById: () => ss },
      LockService: { getScriptLock: () => ({ waitLock: () => {}, releaseLock: () => {} }) },
      Session: { getActiveUser: () => ({ getEmail: () => world.user }) },
      DriveApp: {
        getFolderById: (id) => folders[id],
        getFileById: (id) => ({ getBlob: () => ({ getContentType: () => driveFiles[id].type, getBytes: () => driveFiles[id].bytes }) })
      },
      MailApp: { sendEmail: (m) => mails.push(m) },
      ScriptApp: { getService: () => ({ getUrl: () => 'https://webapp' }) },
      ContentService: { createTextOutput: (t) => ({ setMimeType: () => ({ text: t }) }), MimeType: { JSON: 'json' } },
      Utilities: {
        formatDate: (d) => new Date(d).toISOString(),
        getUuid: () => crypto.randomUUID(),
        newBlob: (bytes, type, name) => ({ bytes, type, name }),
        base64Decode: (s) => Buffer.from(s, 'base64'),
        base64Encode: (b) => Buffer.from(b).toString('base64'),
        computeDigest: (_a, text) => Array.from(crypto.createHash('sha256').update(text, 'utf8').digest()).map((b) => (b > 127 ? b - 256 : b)),
        DigestAlgorithm: { SHA_256: 'sha256' },
        Charset: { UTF_8: 'utf8' }
      },
      GmailApp: {
        createDraft: (to, subject, body, opt) => {
          drafts.push({ owner: world.user, to, subject, body, cc: opt.cc });
          return { getMessage: () => ({ getId: () => 'msg' + drafts.length }) };
        }
      },
      console
    };
  }

  function load(dir, props) {
    const ctx = vm.createContext(services(props));
    for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.gs')).sort()) {
      vm.runInContext(fs.readFileSync(path.join(dir, f), 'utf8'), ctx, { filename: f });
    }
    return ctx;
  }

  const common = { SPREADSHEET_ID: 'ss', INTERNAL_DOMAIN: 'example.co.jp' };
  const root = path.join(__dirname, '..', 'gas');
  world.webapp = load(path.join(root, 'webapp'), { ...common, STAGING_FOLDER_ID: 'staging', DRAFTER_URL: 'https://drafter' });
  world.api = load(path.join(root, 'api'), {
    ...common, ROBOT_TOKEN: 'robot-token', DRAFTER_SECRET: 'drafter-secret',
    SENDKEY_URL_PREFIX: 'https://example.primedrive.jp/', WEBAPP_URL: 'https://webapp'
  });
  world.callApi = (payload) => JSON.parse(world.api.doPost({ postData: { contents: JSON.stringify(payload) } }).text);
  const drafterCtx = services({ API_URL: 'https://api', DRAFTER_SECRET: 'drafter-secret' });
  drafterCtx.UrlFetchApp = {
    fetch: (_url, opt) => {
      const text = world.api.doPost({ postData: { contents: opt.payload } }).text;
      return { getContentText: () => text, getResponseCode: () => 200 };
    }
  };
  world.drafter = vm.createContext(drafterCtx);
  vm.runInContext(fs.readFileSync(path.join(root, 'drafter', 'Code.gs'), 'utf8'), world.drafter);

  world.webapp.setupSheets();
  sheets['承認者'].appendRow(['boss@example.co.jp', '上長 一郎']);
  sheets['取引先'].appendRow(['ABC商事', 'abc-shoji.co.jp', true]);
  return world;
}

function submit(world, over) {
  world.user = 'taro@example.co.jp';
  return world.webapp.submitRequest(Object.assign({
    company: 'ABC商事', to: 'yamada@abc-shoji.co.jp', cc: 'hanako@example.co.jp',
    subject: '見積書送付の件', body: 'ABC商事 山田様\n\nURL：{{URL}}\n期限：{{有効期限}}',
    purpose: '見積書の送付', approver: 'boss@example.co.jp', expiryDays: 7,
    files: [{ name: '見積書.pdf', mimeType: 'application/pdf', size: 3, base64: Buffer.from('pdf').toString('base64') }]
  }, over));
}

test('申請 → 承認 → PAD 発行 → 下書き作成', () => {
  const w = createWorld();
  const res = submit(w);
  assert.ok(res.ok, JSON.stringify(res));
  const id = res.requestId;
  assert.strictEqual(w.mails.at(-1).to, 'boss@example.co.jp');
  const folder = Object.values(w.folders).find((f) => f.id !== 'staging');
  assert.deepStrictEqual(folder.viewers, ['boss@example.co.jp']);

  // 承認前は PAD に仕事が来ない
  assert.strictEqual(w.callApi({ action: 'queue', token: 'robot-token' }).job, null);

  // 申請者は承認できない／確認チェックが無いと承認できない
  assert.throws(() => w.webapp.approveRequest(id, '', { recipients: true, files: true, purpose: true }), /承認者ではありません/);
  w.user = 'boss@example.co.jp';
  assert.throws(() => w.webapp.approveRequest(id, '', { recipients: true }), /すべての確認項目/);
  w.webapp.approveRequest(id, 'OK', { recipients: true, files: true, purpose: true });

  // PAD：トークン不正は拒否
  assert.strictEqual(w.callApi({ action: 'queue', token: 'wrong' }).error, 'unauthorized');
  const job = w.callApi({ action: 'queue', token: 'robot-token' }).job;
  assert.strictEqual(job.requestId, id);
  assert.strictEqual(job.password.length, 12);
  assert.deepStrictEqual(job.files, ['見積書.pdf']);
  assert.strictEqual(w.callApi({ action: 'queue', token: 'robot-token' }).job, null, '同じ申請を二重に取り出さない');

  // ロボットは発行中の申請のファイルを取得できる（トークン必須）
  const file = w.callApi({ action: 'file', token: 'robot-token', requestId: id, index: 0 }).file;
  assert.strictEqual(file.name, '見積書.pdf');
  assert.strictEqual(Buffer.from(file.base64, 'base64').toString(), 'pdf');
  assert.strictEqual(w.callApi({ action: 'file', token: 'wrong', requestId: id, index: 0 }).error, 'unauthorized');
  assert.match(w.callApi({ action: 'file', token: 'robot-token', requestId: id, index: 5 }).error, /ファイルがありません/);

  // 想定外の URL は拒否
  assert.match(w.callApi({ action: 'complete', token: 'robot-token', requestId: id, sendKeyUrl: 'https://evil/' }).error, /形式/);
  assert.ok(w.callApi({ action: 'complete', token: 'robot-token', requestId: id, sendKeyUrl: 'https://example.primedrive.jp/s/KEY' }).ok);
  assert.ok(folder.trashed, '発行後はステージングを削除');

  // 下書き：申請者以外はチケットを発行できない
  assert.throws(() => w.webapp.issueDraftTicket(id), /申請者本人/);
  w.user = 'taro@example.co.jp';
  const url = w.webapp.issueDraftTicket(id);
  const ticket = new URL(url).searchParams.get('ticket');

  // 別ユーザーが URL を開いても作成できない
  w.user = 'other@example.co.jp';
  assert.throws(() => w.drafter.loadPreview(id, ticket), /申請者本人/);
  w.user = 'taro@example.co.jp';
  const preview = w.drafter.loadPreview(id, ticket);
  assert.ok(!preview.passwordMail, '確認画面にはパスワードを返さない');
  assert.match(preview.body, /URL：https:\/\/example\.primedrive\.jp\/s\/KEY/);

  // 全宛先を確認しないと作成できない
  assert.throws(() => w.drafter.createDrafts(id, ticket, ['yamada@abc-shoji.co.jp']), /未確認の宛先/);
  const out = w.drafter.createDrafts(id, ticket, ['yamada@abc-shoji.co.jp', 'hanako@example.co.jp']);
  assert.strictEqual(out.drafts.length, 2);
  assert.strictEqual(w.drafts.length, 2);
  assert.strictEqual(w.drafts[0].owner, 'taro@example.co.jp');
  assert.strictEqual(w.drafts[0].to, 'yamada@abc-shoji.co.jp');
  assert.strictEqual(w.drafts[0].cc, 'hanako@example.co.jp');
  assert.ok(!w.drafts[0].body.includes(job.password), '本文メールにパスワードを含めない');
  assert.ok(w.drafts[1].body.includes(job.password));

  // 下書き作成後はパスワードを消去し、チケットは再利用不可
  const view = w.webapp.getRequest(id);
  assert.strictEqual(view.status, '下書き作成済み');
  const row = w.sheets['申請'].rows.find((r) => r[0] === id);
  assert.strictEqual(row[w.webapp.REQUEST_COLUMNS.indexOf('linkPassword')], '');
  assert.throws(() => w.drafter.createDrafts(id, ticket, ['yamada@abc-shoji.co.jp', 'hanako@example.co.jp']));
  assert.strictEqual(w.drafts.length, 2);
  // 社外へは一切メールを送っていない
  assert.ok(w.mails.every((m) => m.to.endsWith('@example.co.jp')));
});

test('差戻し・発行エラーからの再実行', () => {
  const w = createWorld();
  const id1 = submit(w).requestId;
  w.user = 'boss@example.co.jp';
  assert.throws(() => w.webapp.rejectRequest(id1, ''), /差戻し理由/);
  w.webapp.rejectRequest(id1, '宛先を再確認してください');
  assert.strictEqual(w.webapp.getRequest(id1).status, '差戻し');

  const id2 = submit(w).requestId;
  w.user = 'boss@example.co.jp';
  w.webapp.approveRequest(id2, '', { recipients: true, files: true, purpose: true });
  w.callApi({ action: 'queue', token: 'robot-token' });
  w.callApi({ action: 'fail', token: 'robot-token', requestId: id2, message: 'ログイン失敗' });
  w.user = 'taro@example.co.jp';
  const v = w.webapp.getRequest(id2);
  assert.strictEqual(v.status, '発行エラー');
  assert.ok(v.canRetry);
  w.webapp.retryRequest(id2);
  assert.strictEqual(w.callApi({ action: 'queue', token: 'robot-token' }).job.requestId, id2);
});

test('マスタ外ドメインの申請は登録されない', () => {
  const w = createWorld();
  const res = submit(w, { to: 'yamada@abc-shoj.co.jp' });
  assert.strictEqual(res.ok, false);
  assert.match(res.errors.join(), /入力ミス/);
  assert.strictEqual(w.sheets['申請'].rows.length, 1);
});

test('数式と解釈される文字列は先頭に \' を付けて保存する', () => {
  const w = createWorld();
  const row = w.webapp.requestToRow_({ subject: '=HYPERLINK("http://x")', linkPassword: '-abc', expiryDays: 7 });
  const col = (n) => w.webapp.REQUEST_COLUMNS.indexOf(n);
  assert.strictEqual(row[col('subject')], '\'=HYPERLINK("http://x")');
  assert.strictEqual(row[col('linkPassword')], "'-abc");
  assert.strictEqual(row[col('expiryDays')], 7);
});
