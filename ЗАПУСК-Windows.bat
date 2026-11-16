@echo off
chcp 65001 >nul
title KZStream
cd /d "%~dp0server"
where node >/dev/null 2>/dev/null || (echo Сначала установите Node.js 22 с сайта https://nodejs.org ^(кнопка LTS^), затем запустите этот файл снова. & start https://nodejs.org & pause & exit /b)
if not exist node_modules (echo Установка, подождите минуту... & call npm install --omit=dev)
start "" http://localhost:3000
echo KZStream запущен: http://localhost:3000  ^(не закрывайте это окно^)
node --env-file-if-exists=.env server.js
pause
