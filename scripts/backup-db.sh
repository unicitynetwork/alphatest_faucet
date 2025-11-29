#!/usr/bin/env bash
#
# backup-db.sh - Backup faucet SQLite database
#
# Usage: ./backup-db.sh [OUTPUT_FILE]
#
# If OUTPUT_FILE is not specified, creates timestamped backup in current directory.
#

set -euo pipefail

COMPOSE_PROJECT="alphatest_faucet"
DATA_VOLUME="${COMPOSE_PROJECT}_faucet-data"
CONFIG_VOLUME="${COMPOSE_PROJECT}_faucet-config"
DEFAULT_OUTPUT="faucet-backup-$(date +%Y%m%d-%H%M%S).tar.gz"

OUTPUT_FILE="${1:-$DEFAULT_OUTPUT}"

echo "=========================================="
echo "  ALPHA Test Faucet - Database Backup"
echo "=========================================="
echo ""

# Check if volume exists
if ! docker volume inspect "$DATA_VOLUME" &>/dev/null; then
    echo "Error: Data volume $DATA_VOLUME not found"
    exit 1
fi

echo "Creating backup: $OUTPUT_FILE"
echo ""

# Create temporary directory
TEMP_DIR=$(mktemp -d)
trap 'rm -rf "$TEMP_DIR"' EXIT

# Extract data from volumes
echo "Extracting data from volumes..."
docker run --rm \
    -v "$DATA_VOLUME:/source/data:ro" \
    -v "$CONFIG_VOLUME:/source/config:ro" \
    -v "$TEMP_DIR:/backup" \
    alpine sh -c "
        mkdir -p /backup/data /backup/config
        cp -a /source/data/. /backup/data/ 2>/dev/null || true
        cp -a /source/config/. /backup/config/ 2>/dev/null || true
    "

# Verify database exists
if [[ ! -f "$TEMP_DIR/data/faucet.db" ]]; then
    echo "Error: Database file not found in volume"
    exit 1
fi

# Get database info
DB_SIZE=$(du -h "$TEMP_DIR/data/faucet.db" | cut -f1)
echo "Database size: $DB_SIZE"

# Create compressed archive
echo "Creating compressed archive..."
tar -czf "$OUTPUT_FILE" -C "$TEMP_DIR" data config

# Verify archive
ARCHIVE_SIZE=$(du -h "$OUTPUT_FILE" | cut -f1)
echo ""
echo "Backup complete!"
echo "  File: $OUTPUT_FILE"
echo "  Size: $ARCHIVE_SIZE (compressed)"

# Optional: Upload to S3
if [[ -n "${BACKUP_S3_BUCKET:-}" ]]; then
    echo ""
    echo "Uploading to S3..."
    if command -v aws &>/dev/null; then
        aws s3 cp "$OUTPUT_FILE" "s3://$BACKUP_S3_BUCKET/faucet-backups/"
        echo "Uploaded to: s3://$BACKUP_S3_BUCKET/faucet-backups/$(basename "$OUTPUT_FILE")"
    else
        echo "Warning: AWS CLI not found. Skipping S3 upload."
    fi
fi

echo ""
echo "Done."
