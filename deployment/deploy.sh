#!/bin/bash

# =============================================================================
# EC2 Server Deployment Script (Run this ON the EC2 server)
# Usage: ./deploy.sh [--rebuild]
# =============================================================================

set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

print_status() { echo -e "${GREEN}[✓]${NC} $1"; }
print_warning() { echo -e "${YELLOW}[!]${NC} $1"; }
print_error() { echo -e "${RED}[✗]${NC} $1"; }

PROJECT_DIR="/home/ubuntu/scriptflow-backend"
SECRETS_DIR="$PROJECT_DIR/secrets"

cd "$PROJECT_DIR" || { print_error "Project directory not found: $PROJECT_DIR"; exit 1; }

# =============================================================================
# Pre-flight Checks
# =============================================================================
echo ""
echo "============================================="
echo "  ScriptFlow Deployment"
echo "============================================="
echo ""

# Check Docker is running
if ! docker info > /dev/null 2>&1; then
    print_error "Docker is not running. Start it with: sudo systemctl start docker"
    exit 1
fi
print_status "Docker is running"

# Check secrets directory exists
if [ ! -d "$SECRETS_DIR" ]; then
    print_error "Secrets directory not found: $SECRETS_DIR"
    echo "Create it with: mkdir -p $SECRETS_DIR"
    exit 1
fi

# Check required secret files
MISSING_FILES=0

if [ ! -f "$SECRETS_DIR/.env" ]; then
    print_error "Missing: $SECRETS_DIR/.env"
    MISSING_FILES=1
fi

if [ ! -f "$SECRETS_DIR/gcp-service-account.json" ]; then
    print_error "Missing: $SECRETS_DIR/gcp-service-account.json"
    echo "  Upload your abdul-content-creation-*.json and rename to gcp-service-account.json"
    MISSING_FILES=1
fi

if [ ! -f "$SECRETS_DIR/instagram_cookies.txt" ]; then
    print_warning "Missing: $SECRETS_DIR/instagram_cookies.txt (optional but recommended)"
fi

if [ $MISSING_FILES -eq 1 ]; then
    echo ""
    print_error "Upload missing files via MobaXterm SFTP to: $SECRETS_DIR/"
    exit 1
fi

print_status "All required secrets found"

# =============================================================================
# Validate .env has required variables
# =============================================================================
echo ""
echo "Validating .env configuration..."

REQUIRED_VARS=("MONGODB_URI" "REDIS_URL" "GCP_PROJECT_ID" "IMGBB_API_KEY")
MISSING_VARS=0

for VAR in "${REQUIRED_VARS[@]}"; do
    if ! grep -q "^${VAR}=" "$SECRETS_DIR/.env"; then
        print_error "Missing required variable in .env: $VAR"
        MISSING_VARS=1
    fi
done

if [ $MISSING_VARS -eq 1 ]; then
    echo ""
    echo "Add the missing variables to $SECRETS_DIR/.env"
    exit 1
fi

print_status ".env validation passed"

# =============================================================================
# Git Pull (update code)
# =============================================================================
echo ""
echo "Pulling latest code from git..."

if [ -d ".git" ]; then
    git pull origin main || git pull origin master || print_warning "Git pull failed - continuing with existing code"
    print_status "Code updated"
else
    print_warning "Not a git repository - skipping git pull"
fi

# =============================================================================
# Backup current deployment (if exists)
# =============================================================================
if docker-compose ps | grep -q "app"; then
    print_status "Creating backup of current deployment..."
    BACKUP_DIR="/home/ubuntu/scriptflow-backups/backup-$(date +%Y%m%d-%H%M%S)"
    mkdir -p "$BACKUP_DIR"
    
    # Save current container logs
    docker-compose logs --tail=1000 app > "$BACKUP_DIR/app.log" 2>&1 || true
    
    print_status "Backup saved to: $BACKUP_DIR"
fi

# =============================================================================
# Deploy
# =============================================================================
echo ""
echo "Deploying application..."

# Stop existing containers
docker-compose down 2>/dev/null || true

# Build and start (with --build flag if requested or always for safety)
if [ "$1" == "--rebuild" ] || [ "$1" == "-r" ]; then
    print_status "Rebuilding Docker image..."
    docker-compose --env-file "$SECRETS_DIR/.env" build --no-cache app
fi

docker-compose --env-file "$SECRETS_DIR/.env" up -d --build app

# =============================================================================
# Health Check
# =============================================================================
echo ""
echo "Waiting for application to start..."
sleep 10

MAX_RETRIES=6
RETRY_COUNT=0

while [ $RETRY_COUNT -lt $MAX_RETRIES ]; do
    if curl -sf http://localhost:3000/health > /dev/null 2>&1; then
        print_status "Health check passed!"
        break
    fi
    
    RETRY_COUNT=$((RETRY_COUNT + 1))
    echo "  Attempt $RETRY_COUNT/$MAX_RETRIES - waiting..."
    sleep 5
done

if [ $RETRY_COUNT -eq $MAX_RETRIES ]; then
    print_error "Health check failed after $MAX_RETRIES attempts"
    echo ""
    echo "Check logs with: docker-compose logs app"
    exit 1
fi

# =============================================================================
# Success
# =============================================================================
echo ""
echo "============================================="
echo "  Deployment Successful! 🚀"
echo "============================================="
echo ""
docker-compose ps
echo ""
echo "Application URL: http://$(curl -s ifconfig.me):3000"
echo "Health Check:    http://$(curl -s ifconfig.me):3000/health"
echo ""
echo "Useful commands:"
echo "  View logs:     docker-compose logs -f app"
echo "  Restart:       docker-compose restart app"
echo "  Stop:          docker-compose down"
echo "  Rebuild:       ./deployment/deploy.sh --rebuild"
echo ""
