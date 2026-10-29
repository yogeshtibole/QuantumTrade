#!/bin/sh
set -e
mkdir -p "${QT_DATA:-/app/data}"
chown -R qt:qt "${QT_DATA:-/app/data}" 2>/dev/null || true
exec setpriv --reuid=qt --regid=qt --init-groups /app/quantumtrade