@echo off
chcp 65001 >nul
title BukuPintar - Launcher
echo ============================================
echo   Menyalakan BukuPintar (User + Admin)
echo ============================================
echo.

REM --- Aplikasi user (port 5173) ---
start "BukuPintar - Aplikasi User" cmd /k "cd /d "%~dp0" && npm run dev"

REM --- Dashboard Admin (port 5174) ---
start "BukuPintar - Dashboard Admin" cmd /k "cd /d "%~dp0admin-dashboard" && npm run dev"

echo Dua server sedang dinyalakan di jendela terpisah:
echo    Aplikasi User   : http://localhost:5173
echo    Dashboard Admin : http://localhost:5174
echo.
echo Menunggu server siap, lalu membuka browser...
timeout /t 7 /nobreak >nul
start "" http://localhost:5173
start "" http://localhost:5174
echo.
echo Selesai. Jendela ini boleh ditutup.
echo (Untuk mematikan, tutup kedua jendela server tadi.)
timeout /t 4 >nul
