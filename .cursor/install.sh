#!/usr/bin/env bash
# Idempotent Cloud Agent setup for Memetize.
#
# Installs the system toolchain (PostgreSQL 16 + pgvector, ffmpeg, uv), brings up
# a local PostgreSQL cluster on port 5433 (matching .env.example), creates the
# app and test databases with the pgvector extension, then installs JS/Python
# dependencies and applies the database schema. Safe to run repeatedly.
set -euo pipefail

cd "$(git rev-parse --show-toplevel 2>/dev/null || echo /workspace)"

export DEBIAN_FRONTEND=noninteractive

# --- System packages: PostgreSQL 16 + pgvector, ffmpeg ---
need_apt=0
command -v ffmpeg >/dev/null 2>&1 || need_apt=1
dpkg -s postgresql-16 >/dev/null 2>&1 || need_apt=1
dpkg -s postgresql-16-pgvector >/dev/null 2>&1 || need_apt=1
if [ "$need_apt" = "1" ]; then
  sudo apt-get update -qq
  sudo apt-get install -y -qq \
    postgresql-16 postgresql-16-pgvector postgresql-client-16 ffmpeg
fi

# --- uv for the Python workers ---
if ! command -v uv >/dev/null 2>&1 && [ ! -x "$HOME/.local/bin/uv" ]; then
  curl -LsSf https://astral.sh/uv/install.sh | sh
fi
export PATH="$HOME/.local/bin:$PATH"

# --- PostgreSQL cluster on port 5433 (matches .env.example) ---
sudo pg_conftool 16 main set port 5433
sudo pg_ctlcluster 16 main start 2>/dev/null || sudo pg_ctlcluster 16 main restart
for _ in $(seq 1 30); do
  sudo -u postgres pg_isready -p 5433 -q && break
  sleep 1
done

# --- Role, databases, and the pgvector extension (idempotent) ---
sudo -u postgres psql -p 5433 -tAc "SELECT 1 FROM pg_roles WHERE rolname='memetize'" | grep -q 1 \
  || sudo -u postgres psql -p 5433 -c "CREATE ROLE memetize LOGIN PASSWORD 'memetize' SUPERUSER;"
for dbname in memetize memetize_test; do
  sudo -u postgres psql -p 5433 -tAc "SELECT 1 FROM pg_database WHERE datname='${dbname}'" | grep -q 1 \
    || sudo -u postgres psql -p 5433 -c "CREATE DATABASE ${dbname} OWNER memetize;"
  sudo -u postgres psql -p 5433 -d "${dbname}" -c "CREATE EXTENSION IF NOT EXISTS vector;"
done

# --- .env (created once; existing files are left untouched) ---
if [ ! -f .env ]; then
  cp .env.example .env
  sed -i \
    "s#^TEST_DATABASE_URL=.*#TEST_DATABASE_URL=postgres://memetize:memetize@localhost:5433/memetize_test#" \
    .env
fi

# --- JavaScript + Python dependencies ---
# `pnpm install` exits non-zero purely because esbuild's build script is
# intentionally ignored: the repo relies on esbuild's prebuilt platform binary
# and sets verifyDepsBeforeRun:false (see pnpm-workspace.yaml). Treat that exact
# case as success, but still surface any other install failure.
install_log="$(mktemp)"
if pnpm install --frozen-lockfile >"$install_log" 2>&1; then
  cat "$install_log"
else
  cat "$install_log"
  if ! grep -q "ERR_PNPM_IGNORED_BUILDS" "$install_log"; then
    rm -f "$install_log"
    echo "pnpm install failed for reasons other than ignored build scripts." >&2
    exit 1
  fi
  echo "Continuing past the expected ignored esbuild build scripts."
fi
rm -f "$install_log"

pnpm py:sync

# --- Database schema ---
# A broken install would fail here, so this doubles as an install sanity check.
pnpm db:migrate

echo "Memetize environment ready."
