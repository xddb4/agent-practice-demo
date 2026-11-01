param([string]$Python='D:/codeapp/anaconda/python.exe')
$ErrorActionPreference='Stop'
Set-Location $PSScriptRoot
$env:PYTHONPATH="$PSScriptRoot/.runtime"
if (Test-Path '.env') {
  Get-Content '.env' | ForEach-Object {
    if ($_ -match '^([A-Z_]+)=(.*)$') { [Environment]::SetEnvironmentVariable($matches[1],$matches[2],'Process') }
  }
}
& $Python -m uvicorn backend.app.main:app --host 127.0.0.1 --port 8000
