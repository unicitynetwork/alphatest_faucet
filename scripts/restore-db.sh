#!/usr/bin/env bash
#
# restore-db.sh - Restore faucet database from backup
#
# Usage: ./restore-db.sh BACKUP_FILE
#
# WARNING: This will stop the faucet service and replace the current database.
#

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
COMPOSE_PROJECT="alphatest_faucet"
DATA_VOLUME="${COMPOSE_PROJECT}_faucet-data"
CONFIG_VOLUME="${COMPOSE_PROJECT}_faucet-config"

if [[ $# -lt 1 ]]; then
    echo "Usage: $0 BACKUP_FILE"
    echo ""
    echo "BACKUP_FILE can be:"
    echo "  - Local .tar.gz file"
    echo "  - S3 path (s3://bucket/path)"
    exit 1
fi

BACKUP_FILE="$1"

echo "=========================================="
echo "  ALPHA Test Faucet - Database Restore"
echo "=========================================="
echo ""

# Download from S3 if necessary
if [[ "$BACKUP_FILE" == s3://* ]]; then
    if ! command -v aws &>/dev/null; then
        echo "Error: AWS CLI required for S3 downloads"
        exit 1
    fi

    LOCAL_FILE=$(mktemp --suffix=.tar.gz)
    trap 'rm -f "$LOCAL_FILE"' EXIT

    echo "Downloading from S3..."
    aws s3 cp "$BACKUP_FILE" "$LOCAL_FILE"
    BACKUP_FILE="$LOCAL_FILE"
fi

# Verify backup exists
if [[ ! -f "$BACKUP_FILE" ]]; then
    echo "Error: Backup file not found: $BACKUP_FILE"
    exit 1
fi

# Show backup info
BACKUP_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
echo "Backup file: $BACKUP_FILE"
echo "Backup size: $BACKUP_SIZE"
echo ""

# Confirm restoration
echo "WARNING: This will:"
echo "  1. Stop the faucet container"
echo "  2. Replace the current database with the backup"
echo "  3. Restart the faucet container"
echo ""
read -rp "Are you sure you want to continue? (yes/no): " CONFIRM

if [[ "$CONFIRM" != "yes" ]]; then
    echo "Restoration cancelled."
    exit 0
fi

echo ""

# Stop the faucet container
echo "Stopping faucet service..."
cd "$PROJECT_DIR"
docker compose stop faucet 2>/dev/null || docker-compose stop faucet 2>/dev/null || true

# Create temporary directory
TEMP_DIR=$(mktemp -d)
trap 'rm -rf "$TEMP_DIR"' EXIT

# Extract backup
echo "Extracting backup..."
tar -xzf "$BACKUP_FILE" -C "$TEMP_DIR"

# Verify extracted contents
if [[ ! -f "$TEMP_DIR/data/faucet.db" ]]; then
    echo "Error: Backup does not contain faucet.db"
    exit 1
fi

# Restore to volumes
echo "Restoring to volumes..."
docker run --rm \
    -v "$DATA_VOLUME:/dest/data" \
    -v "$CONFIG_VOLUME:/dest/config" \
    -v "$TEMP_DIR:/backup:ro" \
    alpine sh -c "
        rm -rf /dest/data/* /dest/config/*
        cp -a /backup/data/. /dest/data/ 2>/dev/null || true
        cp -a /backup/config/. /dest/config/ 2>/dev/null || true
        chown -R 1000:1000 /dest/data /dest/config
    "

echo "Restoration complete."
echo ""

# Restart container
echo "Restarting faucet service..."
docker compose start faucet 2>/dev/null || docker-compose start faucet

echo ""
echo "Done. Check logs with: docker compose logs -f faucet"
