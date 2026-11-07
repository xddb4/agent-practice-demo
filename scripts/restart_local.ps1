$ErrorActionPreference='Stop'
$projectRoot=Split-Path -Parent $PSScriptRoot
Set-Location $projectRoot
$listener=Get-NetTCPConnection -LocalPort 8000 -State Listen -ErrorAction SilentlyContinue
if ($listener) {
  $serverProcess=Get-CimInstance Win32_Process -Filter "ProcessId=$($listener[0].OwningProcess)"
  if ($serverProcess.CommandLine -notmatch 'uvicorn backend.app.main:app') { throw '端口8000由其他程序占用，已取消重启' }
  Stop-Process -Id $serverProcess.ProcessId
}
Get-Content '.env' | ForEach-Object {
  if ($_ -match '^([A-Z_]+)=(.*)$') { [Environment]::SetEnvironmentVariable($matches[1],$matches[2],'Process') }
}
$env:PYTHONPATH=Join-Path $projectRoot '.runtime'
Start-Process -FilePath 'D:/codeapp/anaconda/python.exe' -ArgumentList '-m','uvicorn','backend.app.main:app','--host','127.0.0.1','--port','8000' -WorkingDirectory $projectRoot -WindowStyle Hidden -RedirectStandardOutput (Join-Path $projectRoot 'server.out.log') -RedirectStandardError (Join-Path $projectRoot 'server.err.log')
