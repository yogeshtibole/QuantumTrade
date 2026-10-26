# Multi-stage build for the QuantumTrade C++ server (serves the frontend too).
FROM ubuntu:24.04 AS build
RUN apt-get update && apt-get install -y --no-install-recommends g++ cmake make && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY backend ./backend
COPY CMakeLists.txt .
COPY tests ./tests
RUN cmake -B build -DCMAKE_BUILD_TYPE=Release && cmake --build build -j && ./build/test_engine

FROM ubuntu:24.04
RUN useradd -m qt && apt-get update && apt-get install -y --no-install-recommends libstdc++6 && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY --from=build /src/build/quantumtrade /app/quantumtrade
COPY frontend /app/frontend
RUN mkdir -p /app/data && chown -R qt /app
USER qt
ENV QT_PORT=8080 QT_FRONTEND=/app/frontend QT_DATA=/app/data QT_DEV_MODE=0
EXPOSE 8080
HEALTHCHECK CMD bash -c 'exec 3<>/dev/tcp/127.0.0.1/8080 && printf "GET /api/health HTTP/1.0\r\n\r\n" >&3 && grep -q "\"status\":\"ok\"" <&3'
CMD ["/app/quantumtrade"]
