@echo off
rem Porneste serverul panoului si deschide Edge pe tot ecranul, fara bare.
rem Pentru pornire automata: pune o scurtatura la acest fisier in shell:startup

cd /d "%~dp0"
if "%~1"=="server" goto server

set URL=http://localhost:8080

curl -s -o nul -m 2 %URL%/api/config && goto browser

start "Server panou mecanizare" /min cmd /c ""%~f0" server"

set /a incercari=0
:astept
timeout /t 2 /nobreak >nul
curl -s -o nul -m 2 %URL%/api/config && goto browser
set /a incercari+=1
if %incercari% lss 30 goto astept

:browser
start "" msedge --kiosk "%URL%" --edge-kiosk-type=fullscreen --no-first-run --user-data-dir="%~dp0.profil-edge"
exit /b

rem Reporneste serverul daca se opreste din orice motiv.
:server
node server.js
timeout /t 5 /nobreak >nul
goto server
