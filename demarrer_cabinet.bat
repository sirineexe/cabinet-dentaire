@echo off
chcp 65001 >nul
title Cabinet Dentaire - Logiciel de Rendez-vous
cls
echo =====================================================================
echo           LOGICIEL DE GESTION DE RENDEZ-VOUS DU CABINET DENTAIRE
echo =====================================================================
echo.
echo Initialisation du serveur et verification de la base de donnees...
echo.

cd /d "%~dp0"

start "" "http://localhost:3000"

node server.js

pause
