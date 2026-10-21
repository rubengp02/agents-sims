@echo off
cd /d "%~dp0"
node scripts/local-office.mjs start
if errorlevel 1 pause
