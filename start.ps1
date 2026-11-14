$ErrorActionPreference = 'Stop'
Set-Location $PSScriptRoot
if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    throw '请先安装 Docker Desktop 并启动，再运行本脚本。'
}
docker info > $null 2>&1
if ($LASTEXITCODE -ne 0) { throw 'Docker 尚未就绪，请打开 Docker Desktop 并等待引擎启动。' }
docker compose version > $null
if ($LASTEXITCODE -ne 0) { throw '需要支持 Compose V2 的 Docker Desktop。' }
New-Item -ItemType Directory -Path logs -Force > $null
docker compose up -d --build --wait --wait-timeout 180
if ($LASTEXITCODE -ne 0) { throw '启动失败。请运行 docker compose logs --tail 80 web db 查看原因。' }
Write-Host 'StudyPilot 已启动：http://localhost:8000'
Write-Host '警告日志：logs/server.warning.log'
Write-Host '错误日志：logs/server.error.log'
Write-Host '停止服务：docker compose stop'
