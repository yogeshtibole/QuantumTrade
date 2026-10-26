#!/usr/bin/env bash
# Builds and starts QuantumTrade (Linux/macOS). Then open http://localhost:8080
set -e
g++ -std=c++17 -O2 -pthread -I. backend/main.cpp -o quantumtrade
./quantumtrade "$@"
