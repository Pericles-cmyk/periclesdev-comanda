@echo off
chcp 65001 >nul
echo ===============================================
echo  Comanda Local - Endereco para os celulares
echo ===============================================
echo.
echo Procure abaixo o IPv4 do adaptador Wi-Fi que esta conectado ao restaurante.
echo O endereco nos celulares sera: http://IP:3000
echo Exemplo: http://192.168.1.50:3000
echo.
ipconfig | findstr /I /C:"IPv4"
echo.
echo IMPORTANTE: notebook e celulares precisam estar na mesma rede Wi-Fi.
echo Dica: configure reserva de IP no roteador para o notebook nao mudar de endereco.
echo.
pause
