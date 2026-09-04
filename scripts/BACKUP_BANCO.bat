@echo off
cd /d "%~dp0.."
if not exist backups mkdir backups
for /f "tokens=1-4 delims=/ " %%a in ('date /t') do set d=%%a-%%b-%%c
for /f "tokens=1-2 delims=: " %%a in ('time /t') do set t=%%a-%%b
docker exec periclesdev-comanda-db pg_dump -U comanda -d comanda_local -Fc > "backups\comanda_manual_%d%_%t%.backup"
echo Backup manual concluido na pasta backups.
pause
