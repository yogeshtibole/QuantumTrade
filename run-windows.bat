@echo off
REM Builds and starts QuantumTrade (needs g++ from MinGW-w64/MSYS2 on PATH). Then open http://localhost:8080
g++ -std=c++17 -O2 -pthread -I. backend/main.cpp -o quantumtrade.exe -lws2_32
if errorlevel 1 (echo Build failed & pause & exit /b 1)
quantumtrade.exe
pause
