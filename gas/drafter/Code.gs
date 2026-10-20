/**
 * Gmail 下書き作成アプリ（実行ユーザー：アクセスしたユーザー／アクセス：ドメイン内）
 *
 * 申請者本人の Gmail に下書きを 2 通（本文＋URL、パスワード）作成する。メールは送信しない。
 *
 * スクリプトプロパティ：
 *   API_URL         gas/api のデプロイ URL
 *   DRAFTER_SECRET  gas/api と同じ値
 */

function doGet(e) {
  var t = HtmlService.createTemplateFromFile('Confirm');
  t.requestId = (e.parameter.id || '').replace(/[^0-9A-Za-z-]/g, '');
  t.ticket = (e.parameter.ticket || '').replace(/[^0-9a-f]/g, '');
  return t.evaluate()
    .setTitle('Gmail 下書き作成')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function callApi_(payload) {
  var props = PropertiesService.getScriptProperties();
  payload.secret = props.getProperty('DRAFTER_SECRET');
  payload.email = Session.getActiveUser().getEmail();
  var res = UrlFetchApp.fetch(props.getProperty('API_URL'), {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
  var body;
  try {
    body = JSON.parse(res.getContentText());
  } catch (e) {
    throw new Error('API の応答が不正です（HTTP ' + res.getResponseCode() + '）。');
  }
  if (!body.ok) throw new Error(body.error);
  return body;
}

/** 確認画面用（パスワードは含まない）。 */
function loadPreview(requestId, ticket) {
  return callApi_({ action: 'peek', requestId: requestId, ticket: ticket }).content;
}

/**
 * 下書きを作成する。画面で全宛先にチェックが入っていることを確認してから作成する。
 * @param {string[]} confirmedRecipients 画面でチェックされた宛先
 */
function createDrafts(requestId, ticket, confirmedRecipients) {
  var preview = loadPreview(requestId, ticket);
  var all = preview.to.concat(preview.cc);
  var confirmed = (confirmedRecipients || []).map(function (a) { return String(a).toLowerCase(); });
  var missing = all.filter(function (a) { return confirmed.indexOf(a) < 0; });
  if (missing.length) throw new Error('未確認の宛先があります：' + missing.join(', '));

  var c = callApi_({ action: 'redeem', requestId: requestId, ticket: ticket }).content;
  var options = c.cc.length ? { cc: c.cc.join(',') } : {};
  var main = GmailApp.createDraft(c.to.join(','), c.subject, c.body, options);
  var pw = GmailApp.createDraft(c.to.join(','), c.passwordMail.subject, c.passwordMail.body, options);
  callApi_({ action: 'drafted', requestId: requestId, ticket: ticket, draftCount: 2 });

  return {
    drafts: [
      { label: '① 本文（ダウンロードURL）', subject: c.subject, id: main.getMessage().getId() },
      { label: '② パスワード', subject: c.passwordMail.subject, id: pw.getMessage().getId() }
    ]
  };
}
