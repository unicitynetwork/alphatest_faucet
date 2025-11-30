#!/bin/sh
#
# Container entrypoint script
# Initializes configuration and starts the faucet proxy
#

set -e

DATA_DIR="${DATA_DIR:-/app/data}"
CONFIG_DIR="${CONFIG_DIR:-/app/config}"
CONFIG_FILE="${CONFIG_DIR}/config.json"
DATABASE_FILE="${DB_PATH:-${DATA_DIR}/faucet.db}"

echo "=========================================="
echo "  ALPHA Test Faucet Proxy"
echo "=========================================="
echo ""
echo "Data directory: ${DATA_DIR}"
echo "Config directory: ${CONFIG_DIR}"
echo "Database: ${DATABASE_FILE}"
echo ""

# Ensure directories exist (they should already from Dockerfile)
mkdir -p "${DATA_DIR}" "${CONFIG_DIR}" 2>/dev/null || true

# Load configuration from file if it exists
if [ -f "${CONFIG_FILE}" ]; then
    echo "Loading configuration from ${CONFIG_FILE}"

    # Parse config using Node.js
    if [ -z "${FULCRUM_ENDPOINT}" ]; then
        FULCRUM_ENDPOINT=$(node -e "console.log(require('${CONFIG_FILE}').fulcrumEndpoint || '')" 2>/dev/null || echo "")
    fi
    if [ -z "${FAUCET_ENDPOINT}" ]; then
        FAUCET_ENDPOINT=$(node -e "console.log(require('${CONFIG_FILE}').faucetEndpoint || '')" 2>/dev/null || echo "")
    fi
fi

# Apply defaults
FULCRUM_ENDPOINT="${FULCRUM_ENDPOINT:-wss://fulcrum.unicity.network:50004}"
FAUCET_ENDPOINT="${FAUCET_ENDPOINT:-https://faucet.unicity.network/}"

# Export for application
export FULCRUM_ENDPOINT
export FAUCET_ENDPOINT
export DB_PATH="${DATABASE_FILE}"

echo "Configuration:"
echo "  Fulcrum: ${FULCRUM_ENDPOINT}"
echo "  Faucet: ${FAUCET_ENDPOINT}"
echo ""

# Check if database exists
if [ ! -f "${DATABASE_FILE}" ]; then
    echo "WARNING: Database not found at ${DATABASE_FILE}"
    echo ""
    echo "The database must be created using the snapshot CLI before"
    echo "the faucet can process mint requests."
    echo ""
    echo "To create a snapshot, run:"
    echo "  node cli/snapshot.js --rpc <rpc-url> --block <block-number>"
    echo ""
    echo "Starting server anyway (balance queries will return empty)..."
    echo ""
fi

# Save current configuration (non-fatal if write fails)
if [ -w "${CONFIG_DIR}" ] || [ -w "${CONFIG_FILE}" ]; then
    cat > "${CONFIG_FILE}" << EOF
{
  "fulcrumEndpoint": "${FULCRUM_ENDPOINT}",
  "faucetEndpoint": "${FAUCET_ENDPOINT}",
  "lastStarted": "$(date -Iseconds)"
}
EOF
fi

echo "Starting faucet proxy server..."
echo ""

# Start the Node.js application
exec node src/index.js
