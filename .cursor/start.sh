#!/usr/bin/env bash
# Per-boot startup for Memetize: bring PostgreSQL back up (the data directory is
# preserved on disk) and apply any pending migrations. Dependency installation
# lives in install.sh, not here.
set -euo pipefail

cd "$(git rev-parse --show-toplevel 2>/dev/null || echo /workspace)"
export PATH="$HOME/.local/bin:$PATH"

sudo pg_ctlcluster 16 main start 2>/dev/null || true
for _ in $(seq 1 30); do
  sudo -u postgres pg_isready -p 5433 -q && break
  sleep 1
done

pnpm db:migrate || true
