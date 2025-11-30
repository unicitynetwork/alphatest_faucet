#!/usr/bin/env bash
#
# restore-db.sh - Restore faucet database from backup
#
# Usage: ./restore-db.sh [OPTIONS] BACKUP_FILE
#
# Options:
#   -h, --help     Display this help message
#   -y, --yes      Skip confirmation prompt
#
# Arguments:
#   BACKUP_FILE    Backup file to restore from (local path or s3://bucket/path)
#
# Examples:
#   ./restore-db.sh backup.tar.gz              # Restore from local file
#   ./restore-db.sh s3://bucket/backup.tar.gz  # Restore from S3
#   ./restore-db.sh --yes backup.tar.gz        # Skip confirmation
#   ./restore-db.sh --help                     # Show this help
#
# WARNING: This will stop the faucet service and replace the current database.
#

set -euo pipefail

##
## Display usage information
##
usage() {
    sed -n '2,/^[^#]/{ /^#/s/^# \{0,1\}//p }' "$0"
    exit 0
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"
COMPOSE_PROJECT="alphatest_faucet"
DATA_VOLUME="${COMPOSE_PROJECT}_faucet-data"
CONFIG_VOLUME="${COMPOSE_PROJECT}_faucet-config"
SKIP_CONFIRM=false
BACKUP_FILE=""

# Parse arguments
while [[ $# -gt 0 ]]; do
    case "$1" in
        -h|--help)
            usage
            ;;
        -y|--yes)
            SKIP_CONFIRM=true
            shift
            ;;
        -*)
            echo "Unknown option: $1"
            usage
            ;;
        *)
            BACKUP_FILE="$1"
            shift
            ;;
    esac
done

if [[ -z "$BACKUP_FILE" ]]; then
    echo "Error: BACKUP_FILE is required"
    echo ""
    usage
fi

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

if [[ "$SKIP_CONFIRM" == false ]]; then
    read -rp "Are you sure you want to continue? (yes/no): " CONFIRM
    if [[ "$CONFIRM" != "yes" ]]; then
        echo "Restoration cancelled."
        exit 0
    fi
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
