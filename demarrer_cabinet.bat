@echo off
chcp 65001 >nul
title Cabinet Dentaire - Serveur & Synchronisation
cls
echo =====================================================================
echo           LOGICIEL DE GESTION DE RENDEZ-VOUS DU CABINET DENTAIRE
echo =====================================================================
echo.
echo Demarrage du serveur et synchronisation securisee...
echo.

set "PATH=C:\Program Files\nodejs;C:\Program Files (x86)\cloudflared;%PATH%"
cd /d "%~dp0"

start "" "http://localhost:3000"

node server.js

pause
