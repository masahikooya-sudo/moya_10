@echo off
rem 送付キー発行ロボットを 1 回実行する（タスクスケジューラから 5 分ごとに呼び出す）
cd /d %~dp0
if not exist logs mkdir logs
node src\main.js >> logs\console.log 2>&1
