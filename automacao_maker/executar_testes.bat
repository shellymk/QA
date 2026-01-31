@echo off
title Sefaz Runner (Log Interno)
cd /d "D:\Automacoes Maker\automacao_maker"

echo [BAT] Iniciando...
echo [BAT] Acompanhe o arquivo log_blindado.txt

:: O COMANDO CERTO (SEM O SINAL >)
python -u run_tests.py -c config/config.yaml --performance-only --no-report

echo.
echo [BAT] Finalizado.
exit /b %errorlevel%