# Setup

## Windows (VS Code + MinGW g++)
```
cd QuantumTrade
g++ -std=c++17 -O2 -pthread -I. backend/main.cpp -o quantumtrade.exe -lws2_32
quantumtrade.exe
```
Open http://localhost:8080. (If the port is busy: `quantumtrade.exe 9090`.)

## Linux / macOS
```
g++ -std=c++17 -O2 -pthread -I. backend/main.cpp -o quantumtrade && ./quantumtrade
```

## CMake (builds the server and the unit tests)
```
cmake -B build && cmake --build build -j
./build/test_engine && ./build/quantumtrade
```

## Configuration (environment variables)
| Variable | Default | Meaning |
|---|---|---|
| `QT_PORT` | 8080 | listen port (or first CLI argument) |
| `QT_DEV_MODE` | 1 | 1 = show OTP codes in the UI, enable demo Google login. **Set 0 in production.** |
| `QT_JWT_SECRET` | random per start | JWT signing key – set a long random value to keep sessions across restarts |
| `QT_ADMIN_PASSWORD` | `Admin@12345` | password of `admin@quantumtrade.local` created on first start |
| `QT_DATA` | `data` | folder for `store.json` |
| `QT_FRONTEND` | auto (`../frontend`, `frontend`) | static files folder |

Demo accounts (created on first run): `demo@quantumtrade.local / Demo@12345` (trader), `admin@quantumtrade.local` (admin).

## Tests
```
g++ -std=c++17 -O2 -pthread -I. tests/test_engine.cpp -o test_engine && ./test_engine   # unit tests
node tests/api_smoke.js http://localhost:8080                                           # end-to-end (server running)
```

## Docker
`docker compose -f docker/docker-compose.yml up --build` (needs `QT_JWT_SECRET`, `QT_ADMIN_PASSWORD`, TLS certs in `docker/certs/`).
