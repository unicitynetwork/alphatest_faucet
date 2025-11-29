#!/usr/bin/env bash
#
# init-ssl.sh - Initialize SSL certificates with Let's Encrypt
#
# Usage: ./init-ssl.sh DOMAIN [EMAIL]
#

set -euo pipefail

if [[ $# -lt 1 ]]; then
    echo "Usage: $0 DOMAIN [EMAIL]"
    exit 1
fi

DOMAIN="$1"
EMAIL="${2:-admin@$DOMAIN}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_DIR="$(dirname "$SCRIPT_DIR")"

# RSA key size
RSA_KEY_SIZE=4096

# Paths
CERTBOT_CONF_DIR="$PROJECT_DIR/certbot/conf"
CERTBOT_WWW_DIR="$PROJECT_DIR/certbot/www"
NGINX_CONF_DIR="$PROJECT_DIR/nginx/conf.d"

echo "=========================================="
echo "  SSL Certificate Initialization"
echo "=========================================="
echo ""
echo "Domain: $DOMAIN"
echo "Email:  $EMAIL"
echo ""

# Create directories
mkdir -p "$CERTBOT_CONF_DIR" "$CERTBOT_WWW_DIR" "$NGINX_CONF_DIR"

# Check if certificates already exist
if [[ -d "$CERTBOT_CONF_DIR/live/$DOMAIN" ]]; then
    echo "Certificates already exist for $DOMAIN"
    read -rp "Replace existing certificates? (y/n): " REPLACE
    if [[ "$REPLACE" != "y" ]]; then
        echo "Keeping existing certificates."
        exit 0
    fi
fi

# Download recommended TLS parameters
if [[ ! -f "$CERTBOT_CONF_DIR/options-ssl-nginx.conf" ]]; then
    echo "Downloading recommended TLS parameters..."
    curl -s https://raw.githubusercontent.com/certbot/certbot/master/certbot-nginx/certbot_nginx/_internal/tls_configs/options-ssl-nginx.conf \
        > "$CERTBOT_CONF_DIR/options-ssl-nginx.conf"
fi

if [[ ! -f "$CERTBOT_CONF_DIR/ssl-dhparams.pem" ]]; then
    echo "Downloading DH parameters..."
    curl -s https://raw.githubusercontent.com/certbot/certbot/master/certbot/certbot/ssl-dhparams.pem \
        > "$CERTBOT_CONF_DIR/ssl-dhparams.pem"
fi

# Create HTTP-only nginx config for validation
echo "Creating temporary nginx config..."
cat > "$NGINX_CONF_DIR/default.conf" <<EOF
server {
    listen 80;
    server_name $DOMAIN;

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        return 301 https://\$host\$request_uri;
    }
}

server {
    listen 8080;
    server_name _;

    location / {
        proxy_pass http://faucet:3000;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF

# Create dummy certificate for initial nginx startup
DUMMY_CERT_DIR="$CERTBOT_CONF_DIR/live/$DOMAIN"
mkdir -p "$DUMMY_CERT_DIR"

if [[ ! -f "$DUMMY_CERT_DIR/fullchain.pem" ]]; then
    echo "Creating dummy certificate for initial startup..."
    openssl req -x509 -nodes -newkey rsa:2048 -days 1 \
        -keyout "$DUMMY_CERT_DIR/privkey.pem" \
        -out "$DUMMY_CERT_DIR/fullchain.pem" \
        -subj "/CN=localhost" 2>/dev/null
fi

# Start nginx
echo "Starting nginx for certificate validation..."
cd "$PROJECT_DIR"
docker compose up -d nginx 2>/dev/null || docker-compose up -d nginx

# Wait for nginx to start
sleep 5

# Request certificate
echo "Requesting Let's Encrypt certificate..."
docker compose run --rm certbot \
    certbot certonly --webroot \
    --webroot-path=/var/www/certbot \
    --email "$EMAIL" \
    --agree-tos \
    --no-eff-email \
    --force-renewal \
    -d "$DOMAIN" 2>/dev/null || \
docker-compose run --rm certbot \
    certbot certonly --webroot \
    --webroot-path=/var/www/certbot \
    --email "$EMAIL" \
    --agree-tos \
    --no-eff-email \
    --force-renewal \
    -d "$DOMAIN"

# Update nginx config with SSL
echo "Updating nginx config with SSL..."
cat > "$NGINX_CONF_DIR/default.conf" <<EOF
server {
    listen 80;
    server_name $DOMAIN;

    location /.well-known/acme-challenge/ {
        root /var/www/certbot;
    }

    location / {
        return 301 https://\$host\$request_uri;
    }
}

server {
    listen 443 ssl http2;
    server_name $DOMAIN;

    ssl_certificate /etc/letsencrypt/live/$DOMAIN/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/$DOMAIN/privkey.pem;
    include /etc/letsencrypt/options-ssl-nginx.conf;
    ssl_dhparam /etc/letsencrypt/ssl-dhparams.pem;

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    location / {
        proxy_pass http://faucet:3000;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 86400;
    }
}

server {
    listen 8080;
    server_name _;

    location / {
        proxy_pass http://faucet:3000;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }
}
EOF

# Reload nginx
echo "Reloading nginx..."
docker compose exec nginx nginx -s reload 2>/dev/null || \
docker-compose exec nginx nginx -s reload

echo ""
echo "SSL certificates initialized for $DOMAIN"
echo ""
echo "Access your faucet at:"
echo "  https://$DOMAIN"
echo ""
