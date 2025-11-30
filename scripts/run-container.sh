#!/usr/bin/env bash
#
# run-container.sh - L1-to-L3 Token Faucet Proxy Container Manager
#
# Usage: ./run-container.sh [OPTIONS]
#
# Options:
#   --endpoint URL       Fulcrum WebSocket endpoint (default: wss://fulcrum.unicity.network:50004)
#   --rpc URL            Alpha full node RPC URL for snapshot (auto-detected if alpha-node container exists)
#   --snapshot BLOCK     Block number for balance snapshot
#   --faucet URL         Upstream faucet URL (default: https://faucet.unicity.network/)
#   --port PORT          Host port for faucet service (default: 3000)
#   --domain DOMAIN      Domain for SSL certificate
#   --alpha-container    Name of the Alpha node container (default: alpha-node)
#   --reset              Erase volume and rescan balances
#   --no-ssl             Skip nginx/certbot (direct access)
#   --help               Display this help message
#
# Environment Variables:
#   ALPHA_CONTAINER      Name of Alpha node container (default: alpha-node)
#   ALPHA_RPC_PORT       RPC port inside Alpha container (default: 8589)
#   ALPHA_RPC_USER       RPC username (default: user)
#   ALPHA_RPC_PASS       RPC password (default: password)
#   FAUCET_PORT          Host port for faucet (default: 3000)
#

set -euo pipefail

# Resolve script and project directories
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# Constants
CONTAINER_NAME="alphatest-faucet"
COMPOSE_PROJECT="alphatest_faucet"
CONFIG_VOLUME="${COMPOSE_PROJECT}_faucet-config"
DATA_VOLUME="${COMPOSE_PROJECT}_faucet-data"
CONFIG_FILE="/tmp/faucet-deploy-config.json"

# Defaults
DEFAULT_ENDPOINT="wss://fulcrum.unicity.network:50004"
DEFAULT_FAUCET="https://faucet.unicity.network/"

# Variables
ENDPOINT=""
RPC_URL=""
SNAPSHOT=""
FAUCET=""
DOMAIN=""
RESET=false
NO_SSL=false
ALPHA_CONTAINER="${ALPHA_CONTAINER:-alpha-node}"
ALPHA_NETWORK=""
ALPHA_RPC_PORT="${ALPHA_RPC_PORT:-8589}"
ALPHA_RPC_USER="${ALPHA_RPC_USER:-user}"
ALPHA_RPC_PASS="${ALPHA_RPC_PASS:-password}"
FAUCET_PORT="${FAUCET_PORT:-3000}"

##
## Display usage information
##
usage() {
    sed -n '2,/^[^#]/{ /^#/s/^# \{0,1\}//p }' "$0"
    exit 0
}

#######################################
# Log message with timestamp
#######################################
log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $*"
}

#######################################
# Parse command-line arguments
#######################################
parse_args() {
    while [[ $# -gt 0 ]]; do
        case "$1" in
            --endpoint)
                ENDPOINT="$2"
                shift 2
                ;;
            --rpc)
                RPC_URL="$2"
                shift 2
                ;;
            --snapshot)
                SNAPSHOT="$2"
                shift 2
                ;;
            --faucet)
                FAUCET="$2"
                shift 2
                ;;
            --port)
                FAUCET_PORT="$2"
                shift 2
                ;;
            --domain)
                DOMAIN="$2"
                shift 2
                ;;
            --alpha-container)
                ALPHA_CONTAINER="$2"
                shift 2
                ;;
            --reset)
                RESET=true
                shift
                ;;
            --no-ssl)
                NO_SSL=true
                shift
                ;;
            --help|-h)
                usage
                ;;
            *)
                echo "Unknown option: $1"
                usage
                ;;
        esac
    done
}

#######################################
# Check Docker is available
#######################################
check_docker() {
    if ! command -v docker &>/dev/null; then
        echo "Error: Docker is not installed"
        exit 1
    fi

    if ! docker info &>/dev/null; then
        echo "Error: Docker daemon is not running"
        exit 1
    fi

    if ! command -v docker-compose &>/dev/null && ! docker compose version &>/dev/null; then
        echo "Error: Docker Compose is not installed"
        exit 1
    fi
}

#######################################
# Discover Alpha node container network
#######################################
discover_alpha_network() {
    if ! docker inspect "$ALPHA_CONTAINER" &>/dev/null; then
        log "Alpha container '$ALPHA_CONTAINER' not found - will need manual RPC URL"
        return 1
    fi

    # Get the first network the alpha container is connected to
    local networks
    networks=$(docker inspect "$ALPHA_CONTAINER" \
        --format='{{range $k,$v := .NetworkSettings.Networks}}{{$k}} {{end}}' 2>/dev/null) || true

    # Get first network from the list
    ALPHA_NETWORK="${networks%% *}"

    if [[ -z "$ALPHA_NETWORK" ]]; then
        log "Warning: Could not detect Alpha container network"
        return 1
    fi

    log "Discovered Alpha network: $ALPHA_NETWORK"
    export ALPHA_NETWORK
    return 0
}

#######################################
# Auto-detect RPC URL from Alpha container
#######################################
detect_alpha_rpc() {
    if [[ -n "$RPC_URL" ]]; then
        # RPC URL already specified
        log "Using provided RPC URL: $RPC_URL"
        return 0
    fi

    if ! docker inspect "$ALPHA_CONTAINER" &>/dev/null; then
        return 1
    fi

    # Check if alpha container is running
    local state
    state=$(docker inspect "$ALPHA_CONTAINER" --format='{{.State.Running}}' 2>/dev/null) || state="false"
    if [[ "$state" != "true" ]]; then
        log "Warning: Alpha container '$ALPHA_CONTAINER' is not running"
        return 1
    fi

    # Auto-construct RPC URL using container name
    RPC_URL="http://${ALPHA_CONTAINER}:${ALPHA_RPC_PORT}"
    log "Auto-detected RPC URL: $RPC_URL"
    return 0
}

#######################################
# Test RPC connection
#######################################
test_rpc_connection() {
    if [[ -z "$RPC_URL" ]]; then
        return 1
    fi

    log "Testing RPC connection to $RPC_URL..."

    # Try to get blockchain info (basic RPC test)
    local response
    if response=$(docker run --rm --network="$ALPHA_NETWORK" alpine/curl:latest \
        -sf --max-time 5 \
        -X POST "$RPC_URL" \
        -H "Content-Type: application/json" \
        -d '{"method":"getblockchaininfo","params":[],"id":1}' 2>/dev/null); then
        log "RPC connection successful"
        return 0
    else
        log "Warning: RPC connection test failed"
        return 1
    fi
}

#######################################
# Load configuration from Docker volume
#######################################
load_config() {
    rm -f "$CONFIG_FILE"

    # Check if config volume exists
    if docker volume inspect "$CONFIG_VOLUME" &>/dev/null; then
        # Try to extract config.json from volume
        docker run --rm -v "$CONFIG_VOLUME:/config:ro" alpine cat /config/config.json > "$CONFIG_FILE" 2>/dev/null || true
    fi

    if [[ -f "$CONFIG_FILE" ]] && [[ -s "$CONFIG_FILE" ]]; then
        log "Loading existing configuration..."

        # Parse JSON config using node or jq
        if command -v jq &>/dev/null; then
            STORED_ENDPOINT=$(jq -r '.fulcrumEndpoint // empty' "$CONFIG_FILE" 2>/dev/null || echo "")
            STORED_FAUCET=$(jq -r '.faucetEndpoint // empty' "$CONFIG_FILE" 2>/dev/null || echo "")
            STORED_SNAPSHOT=$(jq -r '.snapshotBlock // empty' "$CONFIG_FILE" 2>/dev/null || echo "")
        elif command -v node &>/dev/null; then
            STORED_ENDPOINT=$(node -e "try{console.log(require('$CONFIG_FILE').fulcrumEndpoint||'')}catch(e){}" 2>/dev/null || echo "")
            STORED_FAUCET=$(node -e "try{console.log(require('$CONFIG_FILE').faucetEndpoint||'')}catch(e){}" 2>/dev/null || echo "")
            STORED_SNAPSHOT=$(node -e "try{console.log(require('$CONFIG_FILE').snapshotBlock||'')}catch(e){}" 2>/dev/null || echo "")
        fi

        # Use stored values if not provided via CLI
        [[ -z "$ENDPOINT" ]] && ENDPOINT="${STORED_ENDPOINT:-}"
        [[ -z "$FAUCET" ]] && FAUCET="${STORED_FAUCET:-}"
        [[ -z "$SNAPSHOT" ]] && SNAPSHOT="${STORED_SNAPSHOT:-}"
    fi
}

#######################################
# Prompt for snapshot block if needed
#######################################
prompt_snapshot() {
    if [[ -z "$SNAPSHOT" ]]; then
        echo ""
        echo "Snapshot block number not set."
        read -rp "Enter block number for balance snapshot: " SNAPSHOT
        if [[ -z "$SNAPSHOT" ]] || ! [[ "$SNAPSHOT" =~ ^[0-9]+$ ]]; then
            echo "Error: Invalid block number"
            exit 1
        fi
    fi
}

#######################################
# Apply default values
#######################################
apply_defaults() {
    [[ -z "$ENDPOINT" ]] && ENDPOINT="$DEFAULT_ENDPOINT"
    [[ -z "$FAUCET" ]] && FAUCET="$DEFAULT_FAUCET"
}

#######################################
# Save configuration to Docker volume
#######################################
save_config() {
    local config_json
    config_json=$(cat <<EOF
{
  "fulcrumEndpoint": "$ENDPOINT",
  "faucetEndpoint": "$FAUCET",
  "snapshotBlock": $SNAPSHOT,
  "lastUpdated": "$(date -Iseconds)"
}
EOF
)

    echo "$config_json" > "$CONFIG_FILE"

    # Ensure volume exists
    docker volume create "$CONFIG_VOLUME" &>/dev/null || true

    # Copy config to volume
    docker run --rm -v "$CONFIG_VOLUME:/config" -v "$CONFIG_FILE:/tmp/config.json:ro" \
        alpine cp /tmp/config.json /config/config.json

    log "Configuration saved to volume"
}

#######################################
# Reset volumes if requested
#######################################
handle_reset() {
    if [[ "$RESET" == true ]]; then
        log "Resetting volumes..."

        # Stop containers
        cd "$PROJECT_DIR"
        docker compose down 2>/dev/null || docker-compose down 2>/dev/null || true

        # Remove volumes
        docker volume rm "$CONFIG_VOLUME" "$DATA_VOLUME" 2>/dev/null || true

        rm -f "$CONFIG_FILE"
        log "Volumes reset complete"
    fi
}

#######################################
# Check if database exists in volume
#######################################
database_exists() {
    docker run --rm -v "$DATA_VOLUME:/data:ro" alpine test -f /data/faucet.db 2>/dev/null
    return $?
}

#######################################
# Run snapshot CLI
#######################################
run_snapshot() {
    if [[ -z "$RPC_URL" ]]; then
        echo ""
        echo "Alpha RPC URL required for snapshot."
        echo "Tip: Start an alpha-node container to enable auto-detection"
        read -rp "Enter Alpha full node RPC URL: " RPC_URL
        if [[ -z "$RPC_URL" ]]; then
            echo "Error: RPC URL is required"
            exit 1
        fi
    fi

    log "Running snapshot for block $SNAPSHOT..."

    # Build network argument if alpha network discovered
    local network_arg=""
    if [[ -n "$ALPHA_NETWORK" ]]; then
        network_arg="--network=$ALPHA_NETWORK"
        log "Using network: $ALPHA_NETWORK"
    fi

    # Run snapshot in a temporary container
    # Copy source to writable location since npm ci needs to write node_modules
    # shellcheck disable=SC2086
    docker run --rm $network_arg \
        -v "$DATA_VOLUME:/app/data" \
        -v "$PROJECT_DIR:/app/src:ro" \
        -w /app/build \
        node:20-alpine \
        sh -c "
            cp -r /app/src/package*.json /app/src/cli /app/src/src /app/build/ && \
            npm ci --omit=dev && \
            node cli/snapshot.js \
                --rpc '$RPC_URL' \
                --rpc-user '$ALPHA_RPC_USER' \
                --rpc-pass '$ALPHA_RPC_PASS' \
                --block $SNAPSHOT \
                --output /app/data/faucet.db \
                --fulcrum '$ENDPOINT' \
                --faucet '$FAUCET' && \
            chown -R 100:101 /app/data
        "

    log "Snapshot complete"
}

#######################################
# Initialize SSL certificates
#######################################
init_ssl() {
    if [[ -n "$DOMAIN" ]] && [[ "$NO_SSL" == false ]]; then
        log "Initializing SSL for $DOMAIN..."
        "$SCRIPT_DIR/init-ssl.sh" "$DOMAIN"
    fi
}

#######################################
# Build and start containers
#######################################
start_containers() {
    cd "$PROJECT_DIR"

    log "Stopping existing containers..."
    docker compose down 2>/dev/null || true

    # Export environment variables
    export FULCRUM_ENDPOINT="$ENDPOINT"
    export FAUCET_ENDPOINT="$FAUCET"
    export FAUCET_PORT

    # Ensure alpha network exists (create if not external, or skip if missing)
    if [[ -n "$ALPHA_NETWORK" ]]; then
        if docker network inspect "$ALPHA_NETWORK" &>/dev/null; then
            log "Using existing network: $ALPHA_NETWORK"
            export ALPHA_NETWORK
        else
            log "Warning: Network '$ALPHA_NETWORK' not found, creating it..."
            docker network create "$ALPHA_NETWORK" 2>/dev/null || true
            export ALPHA_NETWORK
        fi
    else
        # No alpha network discovered, use a dummy value that will be created
        export ALPHA_NETWORK="alphatest-faucet-net"
        docker network create "$ALPHA_NETWORK" 2>/dev/null || true
    fi

    log "Building containers..."
    docker compose build --no-cache

    if [[ "$NO_SSL" == true ]]; then
        log "Starting faucet container (no SSL)..."
        docker compose up -d faucet
    else
        log "Starting all containers..."
        docker compose up -d
    fi

    log "Waiting for health check..."
    sleep 10

    # Check health
    if docker compose ps 2>/dev/null | grep -q "healthy"; then
        log "Faucet proxy is running and healthy"
    else
        log "Warning: Container may not be healthy yet"
        log "Check logs with: docker compose logs -f faucet"
    fi
}

#######################################
# Main execution
#######################################
main() {
    echo ""
    echo "=========================================="
    echo "  ALPHA Test Faucet Proxy - Deployment"
    echo "=========================================="
    echo ""

    parse_args "$@"
    check_docker
    handle_reset
    load_config

    # Auto-discover Alpha node network and RPC
    if discover_alpha_network; then
        detect_alpha_rpc
    fi

    prompt_snapshot
    apply_defaults
    save_config

    # Ensure data volume exists
    docker volume create "$DATA_VOLUME" &>/dev/null || true

    # Check if database needs to be created
    if ! database_exists; then
        log "Database not found. Running snapshot..."
        run_snapshot
    else
        log "Database exists. Skipping snapshot."
    fi

    init_ssl
    start_containers

    echo ""
    echo "=========================================="
    echo "  Deployment Complete"
    echo "=========================================="
    echo ""
    echo "Configuration:"
    echo "  Fulcrum:  $ENDPOINT"
    echo "  Faucet:   $FAUCET"
    echo "  Snapshot: Block $SNAPSHOT"
    [[ -n "$ALPHA_NETWORK" ]] && echo "  Alpha Network: $ALPHA_NETWORK"
    [[ -n "$RPC_URL" ]] && echo "  Alpha RPC: ${ALPHA_CONTAINER}:${ALPHA_RPC_PORT}"
    [[ -n "$DOMAIN" ]] && echo "  Domain:   $DOMAIN"
    echo ""
    echo "Access:"
    if [[ "$NO_SSL" == true ]]; then
        echo "  http://localhost:$FAUCET_PORT"
    else
        echo "  http://localhost:80 (HTTP proxy)"
        [[ -n "$DOMAIN" ]] && echo "  https://$DOMAIN (HTTPS)"
    fi
    echo ""
    echo "Commands:"
    echo "  Logs:    docker compose logs -f faucet"
    echo "  Stop:    docker compose down"
    echo "  Restart: docker compose restart"
    echo ""
}

# Check for help early (before banner)
for arg in "$@"; do
    if [[ "$arg" == "--help" ]] || [[ "$arg" == "-h" ]]; then
        usage
    fi
done

main "$@"
