/**
 * PAD（Power Automate Desktop）および下書き作成アプリ向け API
 * （実行ユーザー：システム用アカウント／アクセス：全員（匿名））
 *
 * 匿名アクセスを許可するため、すべての操作をトークンまたはワンタイムチケットで認可する。
 *
 * スクリプトプロパティ：
 *   SPREADSHEET_ID        webapp と同じスプレッドシート
 *   INTERNAL_DOMAIN       自社ドメイン
 *   ROBOT_TOKEN           PAD 用の共有シークレット（32 文字以上のランダム文字列）
 *   DRAFTER_SECRET        下書き作成アプリ用の共有シークレット（32 文字以上）
 *   SENDKEY_URL_PREFIX    PrimeDrive 送付キー URL の先頭（例：https://primedrive.jp/v2/access?key=）
 *   WEBAPP_URL            申請 Web アプリの URL（通知メール用）
 *   PASSWORD_LENGTH       リンクパスワード桁数（省略時 12）
 *   PROCESSING_TIMEOUT_MIN  PAD 処理のタイムアウト分数（省略時 60）
 */

function doPost(e) {
  var req;
  try {
    req = JSON.parse(e.postData.contents);
  } catch (err) {
    return json_({ ok: false, error: 'invalid json' });
  }
  try {
    var handlers = {
      queue: robotQueue_,
      complete: robotComplete_,
      fail: robotFail_,
      peek: draftPeek_,
      redeem: draftRedeem_,
      drafted: draftDone_
    };
    var h = handlers[req.action];
    if (!h) return json_({ ok: false, error: 'unknown action' });
    return json_(h(req));
  } catch (err) {
    return json_({ ok: false, error: String(err.message || err) });
  }
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function prop_(key, fallback) {
  var v = PropertiesService.getScriptProperties().getProperty(key);
  if (!v && fallback === undefined) throw new Error('スクリプトプロパティ ' + key + ' が未設定です。');
  return v || fallback;
}

function safeEquals_(a, b) {
  a = String(a || '');
  b = String(b || '');
  if (!a || a.length !== b.length) return false;
  var diff = 0;
  for (var i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return diff === 0;
}

function requireRobot_(req) {
  if (!safeEquals_(req.token, prop_('ROBOT_TOKEN'))) throw new Error('unauthorized');
}

function formatJst_(d) {
  return Utilities.formatDate(new Date(d), 'Asia/Tokyo', 'yyyy年MM月dd日 HH:mm');
}

// ───────────── PAD 用 ─────────────

/**
 * 承認済み申請を 1 件取り出して「発行中」にし、PAD が操作に必要な情報を返す。
 * 応答例：{ok:true, job:{requestId, folderName, files:[...], password, expiryDays, company}} / {ok:true, job:null}
 */
function robotQueue_(req) {
  requireRobot_(req);
  var timeoutMs = Number(prop_('PROCESSING_TIMEOUT_MIN', '60')) * 60 * 1000;
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    // タイムアウトした処理をエラーに戻す
    listRequests_(function (r) {
      return r.status === STATUS.PROCESSING && Date.now() - new Date(r.robotLockedAt).getTime() > timeoutMs;
    }).forEach(function (r) {
      r.status = STATUS.ERROR;
      r.errorMessage = 'PAD の処理がタイムアウトしました。';
      r.linkPassword = '';
      saveRequest_(r);
      audit_(r.requestId, 'robot', '発行タイムアウト', '');
      notifyApplicant_(r, '送付キーの発行に失敗しました（タイムアウト）。申請画面から再実行してください。');
    });

    var approved = listRequests_(function (r) { return r.status === STATUS.APPROVED; });
    if (approved.length === 0) return { ok: true, job: null };
    var r = approved[0];
    r.status = STATUS.PROCESSING;
    r.robotLockedAt = new Date();
    r.linkPassword = generatePassword(Number(prop_('PASSWORD_LENGTH', '12')), gasRandomBytes_);
    saveRequest_(r);
    audit_(r.requestId, 'robot', '発行開始', '');
    return {
      ok: true,
      job: {
        requestId: r.requestId,
        folderName: r.requestId,
        files: r.files.map(function (f) { return f.name; }),
        password: r.linkPassword,
        expiryDays: r.expiryDays,
        company: r.company
      }
    };
  } finally {
    lock.releaseLock();
  }
}

/** PAD が送付キーを発行し終えたら URL を登録する。 */
function robotComplete_(req) {
  requireRobot_(req);
  var url = String(req.sendKeyUrl || '').trim();
  if (url.indexOf(prop_('SENDKEY_URL_PREFIX')) !== 0) {
    throw new Error('送付キー URL の形式が想定と異なります：' + url);
  }
  var r = transition_(req.requestId, [STATUS.PROCESSING], function (r) {
    r.status = STATUS.ISSUED;
    r.sendKeyUrl = url;
    r.issuedAt = new Date();
    r.keyExpiresAt = req.keyExpiresAt ? new Date(req.keyExpiresAt)
      : new Date(Date.now() + Number(r.expiryDays) * 24 * 60 * 60 * 1000);
  });
  // 送付キー発行後はステージングのファイルを削除
  if (r.folderId) {
    try { DriveApp.getFolderById(r.folderId).setTrashed(true); } catch (e) { audit_(r.requestId, 'robot', 'ステージング削除失敗', String(e)); }
  }
  audit_(r.requestId, 'robot', '送付キー発行', url);
  notifyApplicant_(r, '送付キーが発行されました。申請画面の「下書きを作成」から Gmail の下書きを作成してください。');
  return { ok: true };
}

function robotFail_(req) {
  requireRobot_(req);
  var r = transition_(req.requestId, [STATUS.PROCESSING], function (r) {
    r.status = STATUS.ERROR;
    r.errorMessage = String(req.message || '不明なエラー').slice(0, 1000);
    r.linkPassword = '';
  });
  audit_(r.requestId, 'robot', '発行エラー', r.errorMessage);
  notifyApplicant_(r, '送付キーの発行に失敗しました。\n' + r.errorMessage + '\n\n申請画面から再実行するか、管理者に連絡してください。');
  return { ok: true };
}

// ───────────── 下書き作成アプリ用 ─────────────

/** 下書き作成アプリからの呼び出しを検証し、対象の申請を返す。 */
function verifyTicket_(req, r) {
  if (!safeEquals_(req.secret, prop_('DRAFTER_SECRET'))) throw new Error('unauthorized');
  if (r.status !== STATUS.ISSUED) throw new Error('下書きを作成できる状態ではありません（' + r.status + '）。');
  if (String(req.email).toLowerCase() !== r.applicant) throw new Error('申請者本人のみ下書きを作成できます。');
  if (!r.ticketHash || !safeEquals_(sha256Hex_(String(req.ticket || '')), r.ticketHash)) {
    throw new Error('チケットが無効です。申請画面からやり直してください。');
  }
  if (new Date(r.ticketExpiresAt).getTime() < Date.now()) {
    throw new Error('チケットの有効期限が切れました。申請画面からやり直してください。');
  }
}

function draftContent_(r, includePassword) {
  var expires = formatJst_(r.keyExpiresAt);
  var c = {
    requestId: r.requestId,
    company: r.company,
    to: r.to ? r.to.split(/,\s*/) : [],
    cc: r.cc ? r.cc.split(/,\s*/) : [],
    subject: r.subject,
    body: renderMailBody(r.body, r.sendKeyUrl, expires),
    files: r.files.map(function (f) { return f.name; }),
    expiresAt: expires
  };
  if (includePassword) c.passwordMail = renderPasswordMail(r.subject, r.company, r.linkPassword, expires);
  return c;
}

/** 確認画面用。チケットは消費しない。パスワードは返さない。 */
function draftPeek_(req) {
  var r = findRequest_(req.requestId);
  verifyTicket_(req, r);
  if (r.ticketUsed === true || r.ticketUsed === 'TRUE') throw new Error('このチケットは使用済みです。');
  return { ok: true, content: draftContent_(r, false) };
}

/** 下書き作成直前に呼ぶ。チケットを消費し、パスワード入りの内容を返す。 */
function draftRedeem_(req) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var r = findRequest_(req.requestId);
    verifyTicket_(req, r);
    if (r.ticketUsed === true || r.ticketUsed === 'TRUE') throw new Error('このチケットは使用済みです。');
    r.ticketUsed = true;
    saveRequest_(r);
    audit_(r.requestId, r.applicant, '下書き内容取得', '');
    return { ok: true, content: draftContent_(r, true) };
  } finally {
    lock.releaseLock();
  }
}

/** 下書き作成完了。パスワードをシートから消去する。 */
function draftDone_(req) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    var r = findRequest_(req.requestId);
    verifyTicket_(req, r);
    if (r.ticketUsed !== true && r.ticketUsed !== 'TRUE') throw new Error('下書き内容が取得されていません。');
    r.status = STATUS.DRAFTED;
    r.draftedAt = new Date();
    r.linkPassword = '';
    r.ticketHash = '';
    saveRequest_(r);
    audit_(r.requestId, r.applicant, '下書き作成', '下書き件数=' + (req.draftCount || ''));
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

function notifyApplicant_(r, message) {
  var domain = prop_('INTERNAL_DOMAIN').toLowerCase();
  if (r.applicant.split('@')[1] !== domain) return;
  MailApp.sendEmail({
    to: r.applicant,
    subject: '【外部ファイル送付】' + r.company + '（' + r.requestId + '）' + r.status,
    body: message + '\n\n' + prop_('WEBAPP_URL', '') + '\n',
    noReply: true
  });
}
