/**
 * 社内向け通知メール（申請者・承認者のみ。社外アドレスには送らない）。
 */

function sendInternalMail_(to, subject, body) {
  var domain = PropertiesService.getScriptProperties().getProperty('INTERNAL_DOMAIN').toLowerCase();
  if (String(to).toLowerCase().split('@')[1] !== domain) {
    throw new Error('社外アドレスへの通知は禁止されています：' + to);
  }
  MailApp.sendEmail({ to: to, subject: subject, body: body, noReply: true });
}

function appUrl_() {
  return ScriptApp.getService().getUrl();
}

function notifyApprover_(r) {
  sendInternalMail_(r.approver,
    '【承認依頼】外部ファイル送付 ' + r.company + '（' + r.requestId + '）',
    r.applicant + ' さんから外部ファイル送付の承認依頼が届いています。\n\n' +
    '取引先：' + r.company + '\n' +
    '宛先(To)：' + r.to + '\n' +
    (r.cc ? '宛先(Cc)：' + r.cc + '\n' : '') +
    'ファイル：' + r.files.map(function (f) { return f.name; }).join(', ') + '\n' +
    '送付目的：' + r.purpose + '\n' +
    (r.warnings.length ? '\n⚠ 注意事項：\n・' + r.warnings.join('\n・') + '\n' : '') +
    '\n内容を確認のうえ、承認または差戻しをしてください：\n' + appUrl_() + '\n');
}

function notifyApplicant_(r, message) {
  sendInternalMail_(r.applicant,
    '【外部ファイル送付】' + r.company + '（' + r.requestId + '）' + r.status,
    message + '\n\n' + appUrl_() + '\n');
}
