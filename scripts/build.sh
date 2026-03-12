#!/bin/sh

# scripts/build.sh
# This script ensures environment variables are loaded before running the build.

# 1. Load from .env if it exists (useful for local builds)
if [ -f .env ]; then
    echo "Info: .env file found, exporting variables..."
    set -a
    . ./.env
    set +a
fi

# 2. Proceed with the build
echo "Starting build..."
npm run build

