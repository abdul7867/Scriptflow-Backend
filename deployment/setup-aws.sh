#!/bin/bash

###############################################################################
# ScriptFlow Backend - AWS Setup Script
# This script automates the deployment process on AWS Ubuntu server
###############################################################################

set -e  # Exit on error

echo "=================================================="
echo "ScriptFlow Backend - AWS Deployment Setup"
echo "=================================================="
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Step 1: Check if .env file exists
echo -e "${YELLOW}Step 1: Checking environment configuration...${NC}"
if [ ! -f .env ]; then
    echo -e "${RED}ERROR: .env file not found!${NC}"
    echo ""
    echo "Please create .env file with required configuration:"
    echo "  cp .env.example .env"
    echo "  nano .env"
    echo ""
    echo "Required variables:"
    echo "  - MONGODB_URI"
    echo "  - REDIS_URL"
    echo "  - GCP_PROJECT_ID (set to: abdul-content-creation)"
    echo "  - MANYCHAT_API_KEY"
    echo "  - IMGBB_API_KEY"
    echo "  - ADMIN_API_KEY (generate with: openssl rand -hex 32)"
    echo "  - BASE_URL (e.g., https://your-domain.com)"
    echo ""
    exit 1
fi

# Check GCP_PROJECT_ID
if grep -q "GCP_PROJECT_ID=abdul-content-creation" .env; then
    echo -e "${GREEN}✓ GCP_PROJECT_ID is set correctly${NC}"
else
    echo -e "${RED}WARNING: GCP_PROJECT_ID should be set to 'abdul-content-creation'${NC}"
fi

# Step 2: Check if GCP service account file exists
echo ""
echo -e "${YELLOW}Step 2: Checking GCP service account file...${NC}"
if [ ! -f secrets/gcp-service-account.json ]; then
    echo -e "${RED}ERROR: secrets/gcp-service-account.json not found!${NC}"
    echo ""
    echo "Please upload your service account file:"
    echo "  From your local machine, run:"
    echo "  scp /path/to/gcp-service-account.json ubuntu@your-aws-ip:~/scriptflow-backend/secrets/gcp-service-account.json"
    echo ""
    echo "Or manually create it:"
    echo "  mkdir -p secrets"
    echo "  nano secrets/gcp-service-account.json"
    echo "  (paste the JSON content and save)"
    echo ""
    exit 1
fi

# Verify it's valid JSON
if ! python3 -m json.tool secrets/gcp-service-account.json > /dev/null 2>&1; then
    echo -e "${RED}ERROR: secrets/gcp-service-account.json is not valid JSON!${NC}"
    exit 1
fi

echo -e "${GREEN}✓ GCP service account file is valid${NC}"

# Extract project ID from service account
PROJECT_ID=$(python3 -c "import json; print(json.load(open('secrets/gcp-service-account.json'))['project_id'])")
echo -e "${GREEN}✓ Service account project ID: ${PROJECT_ID}${NC}"

# Step 3: Ensure secrets directory structure
echo ""
echo -e "${YELLOW}Step 3: Setting up secrets directory...${NC}"
mkdir -p secrets

# Create empty instagram cookies file if not exists
if [ ! -f secrets/instagram_cookies.txt ]; then
    touch secrets/instagram_cookies.txt
    echo -e "${GREEN}✓ Created empty instagram_cookies.txt${NC}"
fi

# Set proper permissions
chmod 600 .env
chmod 600 secrets/gcp-service-account.json
chmod 600 secrets/instagram_cookies.txt 2>/dev/null || true
echo -e "${GREEN}✓ File permissions set correctly${NC}"

# Step 4: Stop existing containers
echo ""
echo -e "${YELLOW}Step 4: Stopping existing containers...${NC}"
docker-compose down || true
echo -e "${GREEN}✓ Containers stopped${NC}"

# Step 5: Build new image
echo ""
echo -e "${YELLOW}Step 5: Building Docker image...${NC}"
docker-compose build --no-cache
echo -e "${GREEN}✓ Docker image built successfully${NC}"

# Step 6: Start containers
echo ""
echo -e "${YELLOW}Step 6: Starting containers...${NC}"
docker-compose up -d
echo -e "${GREEN}✓ Containers started${NC}"

# Step 7: Wait for application to start
echo ""
echo -e "${YELLOW}Step 7: Waiting for application to start...${NC}"
sleep 10

# Step 8: Check health
echo ""
echo -e "${YELLOW}Step 8: Checking application health...${NC}"
if curl -f http://localhost:3000/health > /dev/null 2>&1; then
    echo -e "${GREEN}✓ Application is healthy!${NC}"
else
    echo -e "${YELLOW}WARNING: Health check failed. Checking logs...${NC}"
    echo ""
    docker-compose logs --tail=50 app
fi

# Final status
echo ""
echo "=================================================="
echo -e "${GREEN}Deployment Complete!${NC}"
echo "=================================================="
echo ""
echo "Next steps:"
echo "  1. View logs:      docker-compose logs -f app"
echo "  2. Check health:   curl http://localhost:3000/health"
echo "  3. Test endpoint:  curl http://localhost:3000/api/v1/health"
echo ""
echo "If you see 'Vertex AI initialized' in logs, setup is successful!"
echo ""
