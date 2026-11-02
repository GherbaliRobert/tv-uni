@echo off
rem Porneste doar serverul, pentru televizorul care intra pe link din browser.
rem Fereastra afiseaza linkurile. Daca o inchizi, panoul se opreste.

cd /d "%~dp0"
title Server panou mecanizare

curl -s -o nul -m 2 http://localhost:8080/api/config && (
  echo Serverul ruleaza deja.
  timeout /t 5 >nul
  exit /b
)

rem Reporneste serverul daca se opreste din orice motiv.
:server
node server.js
timeout /t 5 /nobreak >nul
goto server
