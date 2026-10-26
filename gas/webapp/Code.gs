/**
 * 外部ファイル送付 申請・承認 Web アプリ（実行ユーザー：システム用アカウント／アクセス：ドメイン内）
 *
 * スクリプトプロパティ：
 *   SPREADSHEET_ID     申請データを保存するスプレッドシート
 *   STAGING_FOLDER_ID  承認前ファイルを置く共有ドライブ上のフォルダ
 *   INTERNAL_DOMAIN    自社ドメイン（例：example.co.jp）
 *   DRAFTER_URL        下書き作成アプリ（gas/drafter）のデプロイ URL
 */

function doGet() {
  return HtmlService.createHtmlOutputFromFile('Index')
    .setTitle('外部ファイル送付申請')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function prop_(key) {
  var v = PropertiesService.getScriptProperties().getProperty(key);
  if (!v) throw new Error('スクリプトプロパティ ' + key + ' が未設定です。');
  return v;
}

function currentUser_() {
  var email = Session.getActiveUser().getEmail();
  if (!email) throw new Error('ユーザーを特定できません。社内アカウントでログインしてください。');
  email = email.toLowerCase();
  if (email.split('@')[1] !== prop_('INTERNAL_DOMAIN').toLowerCase()) {
    throw new Error('社内アカウント以外は利用できません。');
  }
  return email;
}

function isApprover_(email) {
  return listApprovers_().some(function (a) { return a.email === email; });
}

/** 画面に返す形へ変換（パスワード・チケット等の機微情報は返さない）。 */
function toView_(r) {
  return {
    requestId: r.requestId,
    status: r.status,
    createdAt: formatDate_(r.createdAt),
    applicant: r.applicant,
    approver: r.approver,
    company: r.company,
    to: r.to,
    cc: r.cc,
    subject: r.subject,
    body: r.body,
    purpose: r.purpose,
    expiryDays: r.expiryDays,
    files: r.files.map(function (f) { return { name: f.name, size: f.size, url: f.url }; }),
    warnings: r.warnings,
    decidedAt: formatDate_(r.decidedAt),
    approverComment: r.approverComment,
    sendKeyIssued: !!r.sendKeyUrl,
    keyExpiresAt: formatDate_(r.keyExpiresAt),
    errorMessage: r.errorMessage,
    draftedAt: formatDate_(r.draftedAt)
  };
}

function formatDate_(d) {
  if (!d) return '';
  return Utilities.formatDate(new Date(d), 'Asia/Tokyo', 'yyyy/MM/dd HH:mm');
}

// ───────────── google.script.run から呼ばれる関数 ─────────────

function getBootstrap() {
  var me = currentUser_();
  return {
    me: me,
    isApprover: isApprover_(me),
    approvers: listApprovers_().filter(function (a) { return a.email !== me; }),
    clients: listClients_().map(function (c) { return { name: c.name, domains: c.domains }; }),
    limits: LIMITS
  };
}

/** 入力チェックのみ（送信前のプレビュー用）。 */
function checkRequest(input) {
  return validateRequest(input, validationContext_(currentUser_()));
}

function validationContext_(me) {
  return {
    applicant: me,
    internalDomain: prop_('INTERNAL_DOMAIN'),
    clients: listClients_(),
    approvers: listApprovers_().map(function (a) { return a.email; })
  };
}

/**
 * 申請を登録する。
 * @param {Object} input フォーム内容。files は [{name, mimeType, size, base64}]。
 */
function submitRequest(input) {
  var me = currentUser_();
  var result = validateRequest(input, validationContext_(me));
  if (result.errors.length) return { ok: false, errors: result.errors, warnings: result.warnings };
  if (result.warnings.length && !input.acknowledgeWarnings) {
    return { ok: false, errors: [], warnings: result.warnings, needAck: true };
  }

  var requestId = Utilities.formatDate(new Date(), 'Asia/Tokyo', 'yyyyMMdd-HHmmss') + '-' +
    Utilities.getUuid().slice(0, 4).toUpperCase();

  // 承認前ファイルを共有ドライブのステージングフォルダへ保存（承認者のみ閲覧可）
  var folder = DriveApp.getFolderById(prop_('STAGING_FOLDER_ID')).createFolder(requestId);
  var files = input.files.map(function (f) {
    var blob = Utilities.newBlob(Utilities.base64Decode(f.base64), f.mimeType || 'application/octet-stream', f.name);
    var file = folder.createFile(blob);
    return { name: f.name, size: file.getSize(), id: file.getId(), url: file.getUrl() };
  });
  folder.addViewer(input.approver);

  var now = new Date();
  insertRequest_({
    requestId: requestId,
    status: STATUS.PENDING,
    createdAt: now,
    updatedAt: now,
    applicant: me,
    approver: String(input.approver).toLowerCase(),
    company: input.company,
    to: result.to.join(', '),
    cc: result.cc.join(', '),
    subject: input.subject,
    body: input.body,
    purpose: input.purpose,
    expiryDays: Number(input.expiryDays),
    files: files,
    folderId: folder.getId(),
    warnings: result.warnings
  });
  audit_(requestId, me, '申請', '宛先=' + result.to.concat(result.cc).join(' ') +
    ' / ファイル=' + files.map(function (f) { return f.name; }).join(' '));
  notifyApprover_(findRequest_(requestId));
  return { ok: true, requestId: requestId };
}

function listMyRequests() {
  var me = currentUser_();
  return listRequests_(function (r) { return r.applicant === me; }).reverse().map(toView_);
}

function listApprovalRequests() {
  var me = currentUser_();
  return listRequests_(function (r) { return r.approver === me; }).reverse().map(toView_);
}

function getRequest(requestId) {
  var me = currentUser_();
  var r = findRequest_(requestId);
  if (r.applicant !== me && r.approver !== me) throw new Error('この申請を閲覧する権限がありません。');
  var v = toView_(r);
  v.canApprove = r.approver === me && r.status === STATUS.PENDING;
  v.canCancel = r.applicant === me && [STATUS.PENDING, STATUS.APPROVED, STATUS.ERROR].indexOf(r.status) >= 0;
  v.canDraft = r.applicant === me && r.status === STATUS.ISSUED;
  v.canRetry = r.applicant === me && r.status === STATUS.ERROR;
  return v;
}

/**
 * 承認。承認者は宛先とファイル内容を確認したことをチェックする必要がある。
 * @param {Object} checks {recipients:boolean, files:boolean, purpose:boolean}
 */
function approveRequest(requestId, comment, checks) {
  var me = currentUser_();
  if (!checks || !checks.recipients || !checks.files || !checks.purpose) {
    throw new Error('すべての確認項目にチェックしてください。');
  }
  var r = transition_(requestId, [STATUS.PENDING], function (r) {
    if (r.approver !== me) throw new Error('この申請の承認者ではありません。');
    if (r.applicant === me) throw new Error('自分の申請は承認できません。');
    r.status = STATUS.APPROVED;
    r.decidedAt = new Date();
    r.approverComment = comment || '';
  });
  audit_(requestId, me, '承認', comment || '');
  notifyApplicant_(r, '承認されました。送付キーの発行をお待ちください。');
  return toView_(r);
}

function rejectRequest(requestId, comment) {
  var me = currentUser_();
  if (!comment) throw new Error('差戻し理由を入力してください。');
  var r = transition_(requestId, [STATUS.PENDING], function (r) {
    if (r.approver !== me) throw new Error('この申請の承認者ではありません。');
    r.status = STATUS.REJECTED;
    r.decidedAt = new Date();
    r.approverComment = comment;
  });
  trashStagingFolder_(r);
  audit_(requestId, me, '差戻し', comment);
  notifyApplicant_(r, '差戻されました。理由：' + comment);
  return toView_(r);
}

function cancelRequest(requestId) {
  var me = currentUser_();
  var r = transition_(requestId, [STATUS.PENDING, STATUS.APPROVED, STATUS.ERROR], function (r) {
    if (r.applicant !== me) throw new Error('申請者本人のみ取下げできます。');
    r.status = STATUS.CANCELLED;
  });
  trashStagingFolder_(r);
  audit_(requestId, me, '取下げ', '');
  return toView_(r);
}

/** 発行エラーになった申請を再度ロボットの処理待ちに戻す（承認は維持）。 */
function retryRequest(requestId) {
  var me = currentUser_();
  var r = transition_(requestId, [STATUS.ERROR], function (r) {
    if (r.applicant !== me) throw new Error('申請者本人のみ再実行できます。');
    r.status = STATUS.APPROVED;
    r.errorMessage = '';
    r.robotLockedAt = '';
  });
  audit_(requestId, me, '再発行依頼', '');
  return toView_(r);
}

/**
 * 下書き作成アプリへ渡すワンタイムチケットを発行し、遷移先 URL を返す。
 * チケットはハッシュのみ保存し、15 分で失効する。
 */
function issueDraftTicket(requestId) {
  var me = currentUser_();
  var ticket = Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
  transition_(requestId, [STATUS.ISSUED], function (r) {
    if (r.applicant !== me) throw new Error('申請者本人のみ下書きを作成できます。');
    r.ticketHash = sha256Hex_(ticket);
    r.ticketExpiresAt = new Date(Date.now() + 15 * 60 * 1000);
    r.ticketUsed = false;
  });
  audit_(requestId, me, '下書きチケット発行', '');
  return prop_('DRAFTER_URL') + '?id=' + encodeURIComponent(requestId) + '&ticket=' + ticket;
}

function trashStagingFolder_(r) {
  if (!r.folderId) return;
  try {
    DriveApp.getFolderById(r.folderId).setTrashed(true);
  } catch (e) {
    audit_(r.requestId, 'system', 'ステージング削除失敗', String(e));
  }
}
