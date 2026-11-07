@echo off
echo StudyPilot: http://127.0.0.1:8000/
echo Keep this window open while using StudyPilot.
"%SystemRoot%\System32\WindowsPowerShell\v1.0\powershell.exe" -NoProfile -ExecutionPolicy Bypass -File "%~dp0start.ps1"
if errorlevel 1 pause
