/**
 * 検証用：ロボットの代わりに送付キー発行を擬似的に行う（エディタから手動実行）。
 * 承認済みの申請を 1 件取り出し、ダミーの送付キー URL で「発行済み」にする。
 * 本番運用では使用しないこと。
 */
function simulateRobotIssue() {
  var token = prop_('ROBOT_TOKEN');
  var res = robotQueue_({ token: token });
  if (!res.job) {
    Logger.log('承認済み（発行待ち）の申請はありません。');
    return;
  }
  var url = prop_('SENDKEY_URL_PREFIX') + 'example.primedrive.jp/dummy/' + res.job.requestId;
  robotComplete_({ token: token, requestId: res.job.requestId, sendKeyUrl: url });
  Logger.log('発行済みにしました：' + res.job.requestId + ' / ' + url + ' / パスワード：' + res.job.password);
}
