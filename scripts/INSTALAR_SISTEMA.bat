@echo off
chcp 65001 >nul
cd /d "%~dp0.."
echo ===============================================
echo  ComandaWeb - Instalacao local
 echo ===============================================
echo.
where node >nul 2>&1 || (echo ERRO: Node.js nao encontrado. Instale o Node.js LTS e execute novamente.& pause & exit /b 1)
where npm >nul 2>&1 || (echo ERRO: npm nao encontrado. Reinstale o Node.js LTS.& pause & exit /b 1)
where docker >nul 2>&1 || (echo ERRO: Docker nao encontrado. Instale/abra o Docker Desktop e execute novamente.& pause & exit /b 1)

docker info >nul 2>&1 || (echo ERRO: Docker Desktop nao esta pronto. Abra o Docker Desktop e aguarde ele iniciar.& pause & exit /b 1)

echo [1/3] Instalando dependencias do aplicativo...
call npm install
if errorlevel 1 (echo ERRO no npm install.& pause & exit /b 1)

echo.
echo [2/3] Gerando versao de producao...
call npm run build
if errorlevel 1 (echo ERRO no npm run build.& pause & exit /b 1)

echo.
echo [3/3] Preparando PostgreSQL local na porta 5433...
docker compose up -d
if errorlevel 1 (echo ERRO ao preparar o banco. Verifique o Docker Desktop.& pause & exit /b 1)

echo.
echo ===============================================
echo  Instalacao concluida com sucesso.
echo ===============================================
echo Agora use scripts\INICIAR_SISTEMA.bat para abrir o sistema.
echo.
pause
