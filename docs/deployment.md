# Deployment Guide

## Prerequisites

- Docker and Docker Compose
- Access to an Alpha full node RPC (for snapshot creation)
- Domain name (optional, for SSL)

## Quick Start

### 1. Clone and Configure

```bash
git clone <repository-url>
cd alphatest_faucet
cp .env.example .env
```

### 2. Create Snapshot and Start

```bash
./scripts/run-container.sh \
  --rpc http://your-alpha-node:8332 \
  --snapshot 123456
```

This will:
1. Connect to your Alpha node
2. Scan the UTXO set at block 123456
3. Create the balance database
4. Start the faucet proxy

### 3. Access the Faucet

- Web UI: http://localhost:8080
- API: http://localhost:8080/api/v1/faucet/

## Configuration Options

### run-container.sh Arguments

| Argument | Description | Default |
|----------|-------------|---------|
| `--endpoint` | Fulcrum WebSocket URL | `wss://fulcrum.unicity.network:50004` |
| `--rpc` | Alpha full node RPC URL | (required for snapshot) |
| `--snapshot` | Block number for balance snapshot | (persisted from previous run) |
| `--faucet` | Upstream faucet URL | `https://faucet.unicity.network/` |
| `--domain` | Domain for SSL certificate | (none) |
| `--reset` | Erase volumes and rescan | `false` |
| `--no-ssl` | Skip nginx/SSL setup | `false` |

### Environment Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `PORT` | API server port | `3000` |
| `DB_PATH` | SQLite database path | `./data/faucet.db` |
| `FULCRUM_ENDPOINT` | Fulcrum WebSocket URL | `wss://fulcrum.unicity.network:50004` |
| `FAUCET_ENDPOINT` | Upstream faucet URL | `https://faucet.unicity.network/` |
| `LOG_LEVEL` | Logging level | `info` |
| `CORS_ORIGIN` | Allowed CORS origins | `*` |

## SSL Setup

### With Let's Encrypt

```bash
./scripts/run-container.sh \
  --domain faucet.yourdomain.com \
  --snapshot 123456 \
  --rpc http://alpha-node:8332
```

This will:
1. Request a certificate from Let's Encrypt
2. Configure nginx for HTTPS
3. Set up automatic certificate renewal

### Manual Certificate

Place your certificates in:
- `certbot/conf/live/<domain>/fullchain.pem`
- `certbot/conf/live/<domain>/privkey.pem`

Then update `nginx/conf.d/default.conf` with your domain.

## Database Management

### Backup

```bash
./scripts/backup-db.sh [output-file.tar.gz]
```

Creates a compressed backup of the database and configuration.

### Restore

```bash
./scripts/restore-db.sh backup-file.tar.gz
```

Stops the service, restores from backup, and restarts.

### S3 Backup

Set `BACKUP_S3_BUCKET` environment variable:

```bash
export BACKUP_S3_BUCKET=my-backup-bucket
./scripts/backup-db.sh
```

## Monitoring

### Health Check

```bash
curl http://localhost:3000/health
```

### View Logs

```bash
docker compose logs -f faucet
```

### Statistics

```bash
curl http://localhost:3000/api/v1/faucet/stats
```

## Troubleshooting

### Database Not Found

If the faucet starts but shows "Database not found":

1. Ensure the snapshot has been created
2. Check volume mounts in docker-compose.yml
3. Run with `--reset` to recreate the database

### Connection Refused to Alpha RPC

1. Verify the RPC URL is correct
2. Check firewall/network access
3. Ensure RPC authentication if required (`--rpc-user`, `--rpc-pass`)

### SSL Certificate Issues

1. Ensure domain DNS points to your server
2. Check port 80 is accessible for ACME challenge
3. View certbot logs: `docker compose logs certbot`

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                      nginx (SSL)                        │
│                    ports: 80, 443                       │
└─────────────────────┬───────────────────────────────────┘
                      │
                      ▼
┌─────────────────────────────────────────────────────────┐
│                   Faucet Proxy                          │
│                    port: 3000                           │
│  ┌─────────────┐  ┌──────────────┐  ┌───────────────┐  │
│  │ Balance API │  │ Signature    │  │ Faucet Proxy  │  │
│  │             │  │ Verification │  │ Service       │  │
│  └──────┬──────┘  └──────────────┘  └───────┬───────┘  │
│         │                                    │          │
│         ▼                                    ▼          │
│  ┌─────────────┐                    ┌───────────────┐  │
│  │   SQLite    │                    │ Upstream      │  │
│  │  (balances) │                    │ Faucet API    │  │
│  └─────────────┘                    └───────────────┘  │
└─────────────────────────────────────────────────────────┘
```

## Production Checklist

- [ ] Configure proper CORS origins
- [ ] Set up SSL with valid domain
- [ ] Configure log rotation
- [ ] Set up monitoring/alerting
- [ ] Schedule regular backups
- [ ] Test restore procedure
- [ ] Configure rate limiting (if needed)
- [ ] Review security headers in nginx
