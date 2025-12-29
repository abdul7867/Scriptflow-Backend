#!/bin/bash

# =============================================================================
# Automated AWS Deployment Script for ScriptFlow Backend
# Usage: ./deploy-to-aws.sh <EC2_IP> <PEM_KEY_PATH> [PROJECT_DIR]
# Example: ./deploy-to-aws.sh 13.234.56.78 ~/.ssh/scriptflow-key.pem
# Example: ./deploy-to-aws.sh 13.234.56.78 ~/.ssh/scriptflow-key.pem /path/to/project
# =============================================================================

set -e

# Colors
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

print_status() {
    echo -e "${GREEN}[✓]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[!]${NC} $1"
}

print_error() {
    echo -e "${RED}[✗]${NC} $1"
}

# Check arguments
if [ $# -lt 2 ]; then
    print_error "Usage: $0 <EC2_IP> <PEM_KEY_PATH> [PROJECT_DIR]"
    echo "Example: $0 13.234.56.78 ~/.ssh/scriptflow-key.pem"
    echo "Example: $0 13.234.56.78 ~/.ssh/scriptflow-key.pem /path/to/scriptflow"
    exit 1
fi

EC2_IP=$1
PEM_KEY=$2
EC2_USER="ubuntu"
REMOTE_DIR="/home/ubuntu/scriptflow-backend"

# Use provided directory or default to parent of deployment folder (the project root)
if [ -n "$3" ]; then
    LOCAL_DIR="$3"
else
    # Get the directory where this script is located, then go up one level
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
    LOCAL_DIR="$(dirname "$SCRIPT_DIR")"
fi

# Validate PEM key exists
if [ ! -f "$PEM_KEY" ]; then
    print_error "PEM key file not found: $PEM_KEY"
    exit 1
fi

# Validate project directory exists
if [ ! -d "$LOCAL_DIR" ]; then
    print_error "Project directory not found: $LOCAL_DIR"
    exit 1
fi

# Check for required files
if [ ! -f "$LOCAL_DIR/docker-compose.yml" ]; then
    print_error "docker-compose.yml not found in $LOCAL_DIR"
    print_error "Make sure you're pointing to the correct project directory"
    exit 1
fi

print_status "Project directory: $LOCAL_DIR"
print_status "Starting deployment to AWS EC2: $EC2_IP"

# Test SSH connection
print_status "Testing SSH connection..."
if ! ssh -i "$PEM_KEY" -o ConnectTimeout=10 -o StrictHostKeyChecking=no "$EC2_USER@$EC2_IP" "echo 'Connection successful'"; then
    print_error "Cannot connect to EC2 instance. Check:"
    echo "  - EC2 instance is running"
    echo "  - Security group allows SSH from your IP"
    echo "  - PEM key is correct"
    exit 1
fi

# Create remote directory
print_status "Creating remote directory..."
ssh -i "$PEM_KEY" "$EC2_USER@$EC2_IP" "mkdir -p $REMOTE_DIR"

# Sync files using rsync (faster and better than scp)
print_status "Syncing files to EC2... (this may take a few minutes)"
rsync -avz -e "ssh -i $PEM_KEY" \
    --exclude 'node_modules' \
    --exclude '.git' \
    --exclude 'temp/*' \
    --exclude '.env' \
    --exclude '*.log' \
    --exclude 'dist' \
    "$LOCAL_DIR/" "$EC2_USER@$EC2_IP:$REMOTE_DIR/"

print_status "Files synced successfully"

# Upload fonts directory (important for image generation)
if [ -d "$LOCAL_DIR/fonts" ]; then
    print_status "Syncing fonts directory..."
    rsync -avz -e "ssh -i $PEM_KEY" "$LOCAL_DIR/fonts/" "$EC2_USER@$EC2_IP:$REMOTE_DIR/fonts/"
    print_status "Fonts synced"
fi

# Upload sensitive files separately
print_warning "Uploading sensitive files..."

if [ -f "$LOCAL_DIR/.env" ]; then
    scp -i "$PEM_KEY" "$LOCAL_DIR/.env" "$EC2_USER@$EC2_IP:$REMOTE_DIR/.env"
    print_status ".env uploaded"
else
    print_warning ".env not found locally - you'll need to create it on the server"
fi

if [ -f "$LOCAL_DIR/gcp-service-account.json" ]; then
    scp -i "$PEM_KEY" "$LOCAL_DIR/gcp-service-account.json" "$EC2_USER@$EC2_IP:$REMOTE_DIR/gcp-service-account.json"
    print_status "GCP service account uploaded"
else
    print_warning "gcp-service-account.json not found - you'll need to upload it manually"
fi

if [ -f "$LOCAL_DIR/instagram_cookies.txt" ]; then
    scp -i "$PEM_KEY" "$LOCAL_DIR/instagram_cookies.txt" "$EC2_USER@$EC2_IP:$REMOTE_DIR/instagram_cookies.txt"
    print_status "Instagram cookies uploaded"
fi

# Deploy on server
print_status "Deploying application on EC2..."
ssh -i "$PEM_KEY" "$EC2_USER@$EC2_IP" << 'DEPLOY_SCRIPT'
cd /home/ubuntu/scriptflow-backend

# Check if Docker is installed
if ! command -v docker &> /dev/null; then
    echo "Docker not found. Please run ubuntu-setup.sh first!"
    exit 1
fi

# Check if .env exists
if [ ! -f .env ]; then
    echo "WARNING: .env file not found!"
    echo "Please create .env file before starting the application"
    exit 1
fi

# Stop existing containers
echo "Stopping existing containers..."
docker-compose down 2>/dev/null || true

# Build and start
echo "Building and starting containers..."
docker-compose up -d --build app

# Wait for health check
echo "Waiting for application to start..."
sleep 10

# Check if container is running
if docker-compose ps | grep -q "Up"; then
    echo "✓ Application deployed successfully!"
    docker-compose ps
    echo ""
    echo "View logs with: docker-compose logs -f app"
else
    echo "✗ Application failed to start. Check logs:"
    docker-compose logs app
    exit 1
fi
DEPLOY_SCRIPT

if [ $? -eq 0 ]; then
    print_status "Deployment completed successfully! 🚀"
    echo ""
    echo "Access your application at: http://$EC2_IP:3000"
    echo "Health check: http://$EC2_IP:3000/health"
    echo ""
    echo "To view logs, run:"
    echo "  ssh -i $PEM_KEY $EC2_USER@$EC2_IP 'cd $REMOTE_DIR && docker-compose logs -f app'"
else
    print_error "Deployment failed. Check the logs above."
    exit 1
fi
