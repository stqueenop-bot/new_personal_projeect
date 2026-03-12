#!/bin/sh

# scripts/build.sh
# This script ensures environment variables are loaded before running the build.

# 1. Load from .env if it exists (useful for local builds)
if [ -f .env ]; then
    echo "Info: .env file found, exporting variables..."
    # Export variables, ignoring comments and empty lines
    export $(grep -v '^#' .env | xargs)
fi

# 2. Check for critical variables (optional, for debugging)
if [ -z "$DATABASE_URL" ]; then
    echo "Warning: DATABASE_URL is not set. Prisma generation might fail."
    # We could set a fallback here if needed, but since user said no to dummy,
    # we'll let it fail or proceed if it's somehow handled.
fi

# 3. Proceed with the build
echo "Starting build..."
npm run build
