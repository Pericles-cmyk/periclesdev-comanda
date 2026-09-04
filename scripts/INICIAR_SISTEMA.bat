@echo off
cd /d "%~dp0.."
echo Iniciando banco local do Comanda Local...
docker compose up -d
if errorlevel 1 (
  echo.
  echo Falha ao iniciar o banco. Confirme se o Docker Desktop esta aberto.
  pause
  exit /b 1
)
echo Aguardando PostgreSQL...
timeout /t 4 /nobreak >nul
set "DATABASE_URL=postgres://comanda:comanda_local_2026@localhost:5433/comanda_local"
set "TZ=America/Recife"
echo Iniciando servidor local e tempo real...
start "Comanda Local Local Server - NAO FECHAR" cmd /k "set DATABASE_URL=%DATABASE_URL%&& set TZ=%TZ%&& npm start"
timeout /t 3 /nobreak >nul
echo.
echo Sistema: http://localhost:3000
echo Nos celulares, use http://IP_DO_NOTEBOOK:3000
echo.
ipconfig | findstr /C:"IPv4"
start http://localhost:3000
pause
