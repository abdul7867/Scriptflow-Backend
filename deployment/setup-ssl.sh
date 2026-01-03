#!/bin/bash

# =============================================================================
# SSL/HTTPS Setup with NGINX and Let's Encrypt
# Usage: ./setup-ssl.sh <domain>
# Example: ./setup-ssl.sh api.scriptflow.com
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

# Check arguments
if [ $# -lt 1 ]; then
    print_error "Usage: $0 <domain>"
    echo "Example: $0 api.scriptflow.com"
    echo ""
    echo "Prerequisites:"
    echo "  1. Domain must point to this server's IP address"
    echo "  2. Port 80 and 443 must be open in AWS Security Group"
    exit 1
fi

DOMAIN=$1
EMAIL="${2:-admin@$DOMAIN}"
PROJECT_DIR="/home/ubuntu/scriptflow-backend"

echo ""
echo "============================================="
echo "  SSL/HTTPS Setup for $DOMAIN"
echo "============================================="
echo ""

# =============================================================================
# Install NGINX
# =============================================================================
print_status "Installing NGINX..."
sudo apt-get update -y
sudo apt-get install -y nginx

# =============================================================================
# Install Certbot
# =============================================================================
print_status "Installing Certbot..."
sudo apt-get install -y certbot python3-certbot-nginx

# =============================================================================
# Create NGINX Configuration
# =============================================================================
print_status "Creating NGINX configuration..."

sudo tee /etc/nginx/sites-available/scriptflow > /dev/null << EOF
# ScriptFlow API - NGINX Configuration
# HTTP → HTTPS redirect handled by Certbot

upstream scriptflow_backend {
    server 127.0.0.1:3000;
    keepalive 64;
}

server {
    listen 80;
    listen [::]:80;
    server_name $DOMAIN;

    # Let's Encrypt challenge
    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }

    # Redirect all HTTP to HTTPS (after SSL is configured)
    location / {
        return 301 https://\$server_name\$request_uri;
    }
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name $DOMAIN;

    # SSL certificates (will be configured by Certbot)
    # ssl_certificate /etc/letsencrypt/live/$DOMAIN/fullchain.pem;
    # ssl_certificate_key /etc/letsencrypt/live/$DOMAIN/privkey.pem;

    # Security headers
    add_header X-Frame-Options "SAMEORIGIN" always;
    add_header X-Content-Type-Options "nosniff" always;
    add_header X-XSS-Protection "1; mode=block" always;
    add_header Referrer-Policy "strict-origin-when-cross-origin" always;

    # Gzip compression
    gzip on;
    gzip_vary on;
    gzip_min_length 1024;
    gzip_proxied any;
    gzip_types text/plain text/css text/xml text/javascript application/javascript application/json application/xml;

    # Client body size (for file uploads)
    client_max_body_size 50M;

    # Timeouts
    proxy_connect_timeout 60s;
    proxy_send_timeout 60s;
    proxy_read_timeout 60s;

    # API endpoints
    location / {
        proxy_pass http://scriptflow_backend;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_cache_bypass \$http_upgrade;
    }

    # Health check endpoint
    location /health {
        proxy_pass http://scriptflow_backend/health;
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
    }
}
EOF

# Enable the site
sudo ln -sf /etc/nginx/sites-available/scriptflow /etc/nginx/sites-enabled/
sudo rm -f /etc/nginx/sites-enabled/default

# Test NGINX configuration
print_status "Testing NGINX configuration..."
sudo nginx -t

# Reload NGINX
sudo systemctl reload nginx
print_status "NGINX configured successfully"

# =============================================================================
# Get SSL Certificate
# =============================================================================
echo ""
print_warning "Getting SSL certificate from Let's Encrypt..."
echo "Make sure your domain ($DOMAIN) points to this server's IP!"
echo ""

# Prompt for email
echo "Enter email for SSL certificate notifications (or press Enter for $EMAIL):"
read -r USER_EMAIL
if [ -n "$USER_EMAIL" ]; then
    EMAIL="$USER_EMAIL"
fi

# Get certificate
sudo certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos --email "$EMAIL" --redirect

# =============================================================================
# Setup Auto-Renewal
# =============================================================================
print_status "Setting up automatic certificate renewal..."

# Test renewal
sudo certbot renew --dry-run

# Cron job for renewal (certbot package adds this automatically, but let's verify)
if ! crontab -l 2>/dev/null | grep -q "certbot renew"; then
    (crontab -l 2>/dev/null; echo "0 3 * * * /usr/bin/certbot renew --quiet --post-hook 'systemctl reload nginx'") | crontab -
    print_status "Auto-renewal cron job added"
fi

# =============================================================================
# Update Firewall
# =============================================================================
print_status "Updating firewall rules..."

# Remove direct access to port 3000 (now behind NGINX)
sudo ufw delete allow 3000/tcp 2>/dev/null || true
print_warning "Removed direct access to port 3000 (now behind NGINX)"

# =============================================================================
# Summary
# =============================================================================
echo ""
echo "============================================="
echo "  SSL Setup Complete! 🔒"
echo "============================================="
echo ""
echo "Your API is now available at:"
echo "  https://$DOMAIN"
echo ""
echo "Health check:"
echo "  https://$DOMAIN/health"
echo ""
echo "Certificate auto-renewal is configured."
echo ""
echo "IMPORTANT: Update your .env file:"
echo "  BASE_URL=https://$DOMAIN"
echo ""
echo "Then restart the application:"
echo "  cd $PROJECT_DIR && ./deployment/deploy.sh"
echo ""
print_status "SSL setup completed successfully! 🚀"
