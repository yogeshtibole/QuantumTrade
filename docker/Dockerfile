FROM ubuntu:24.04 AS build
RUN apt-get update \
    && apt-get install -y --no-install-recommends g++ cmake make \
    && rm -rf /var/lib/apt/lists/*
WORKDIR /src
COPY CMakeLists.txt ./
COPY backend ./backend
COPY tests ./tests
RUN cmake -B build -DCMAKE_BUILD_TYPE=Release \
    && cmake --build build -j1 \
    && ./build/test_engine

FROM ubuntu:24.04
RUN apt-get update \
    && apt-get install -y --no-install-recommends libstdc++6 ca-certificates util-linux \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home qt
WORKDIR /app
COPY --from=build /src/build/quantumtrade /app/quantumtrade
COPY frontend /app/frontend
COPY docker/entrypoint.sh /app/entrypoint.sh
RUN sed -i 's/\r$//' /app/entrypoint.sh && chmod +x /app/entrypoint.sh && mkdir -p /app/data && chown -R qt:qt /app
ENV QT_FRONTEND=/app/frontend QT_DATA=/app/data
EXPOSE 8080
ENTRYPOINT ["/app/entrypoint.sh"]