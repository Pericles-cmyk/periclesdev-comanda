@echo off
cd /d "%~dp0.."
echo Feche a janela "Comanda Local Local Server - NAO FECHAR" e pressione uma tecla.
pause >nul
docker compose stop db
echo Banco local parado com seguranca.
pause
