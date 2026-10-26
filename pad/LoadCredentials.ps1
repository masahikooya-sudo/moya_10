$ErrorActionPreference = 'Stop'
[void][Windows.Security.Credentials.PasswordVault, Windows.Security.Credentials, ContentType = WindowsRuntime]
$vault = New-Object Windows.Security.Credentials.PasswordVault
function Get-Secret($name) { $c = $vault.Retrieve('PADRobot', $name); $c.RetrievePassword(); return $c.Password }
function ConvertTo-B64($s) { return [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($s)) }
$out = @(
  (ConvertTo-B64 (Get-Secret 'PrimeDriveCorpId')),
  (ConvertTo-B64 (Get-Secret 'PrimeDriveUserId')),
  (ConvertTo-B64 (Get-Secret 'PrimeDrivePassword')),
  (Get-Secret 'RobotToken')
)
Write-Output ($out -join '|')
