#!/bin/bash

# =============================================================================
# Ubuntu Server Setup Script for AWS
# Installs: Git, NVM, Node.js (LTS), Docker, Docker Compose
# =============================================================================

set -e  # Exit on any error

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

print_status() {
    echo -e "${GREEN}[✓]${NC} $1"
}

print_warning() {
    echo -e "${YELLOW}[!]${NC} $1"
}

print_error() {
    echo -e "${RED}[✗]${NC} $1"
}

print_header() {
    echo ""
    echo "============================================="
    echo "  $1"
    echo "============================================="
    echo ""
}

# =============================================================================
# Update System Packages
# =============================================================================
print_header "Updating System Packages"
sudo apt-get update -y
sudo apt-get upgrade -y

# Install Python symlink (needed for yt-dlp)
sudo apt-get install -y python-is-python3
print_status "System packages updated"

# =============================================================================
# Install Git
# =============================================================================
print_header "Installing Git"
sudo apt-get install -y git
git --version
print_status "Git installed successfully"

# =============================================================================
# Install NVM and Node.js LTS
# =============================================================================
print_header "Installing NVM and Node.js LTS"

# Install dependencies for NVM
sudo apt-get install -y curl

# Install NVM (using latest stable version)
export NVM_DIR="$HOME/.nvm"
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash

# Load NVM immediately
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
[ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"

# Install Node.js LTS
nvm install --lts
nvm use --lts
nvm alias default lts/*

# Verify installation
node --version
npm --version

print_status "NVM and Node.js LTS installed successfully"

# =============================================================================
# Install Docker
# =============================================================================
print_header "Installing Docker"

# Remove old versions if any
sudo apt-get remove -y docker docker-engine docker.io containerd runc 2>/dev/null || true

# Install dependencies
sudo apt-get install -y \
    ca-certificates \
    curl \
    gnupg \
    lsb-release

# Add Docker's official GPG key
sudo mkdir -p /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg

# Set up Docker repository
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(lsb_release -cs) stable" | sudo tee /etc/apt/sources.list.d/docker.list > /dev/null

# Install Docker Engine
sudo apt-get update -y
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin

# Add current user to docker group (to run docker without sudo)
sudo usermod -aG docker $USER

# Start and enable Docker service
sudo systemctl start docker
sudo systemctl enable docker

# Verify Docker installation
sudo docker --version
print_status "Docker installed successfully"

# =============================================================================
# Install Docker Compose (Standalone - Optional, as plugin is already installed)
# =============================================================================
print_header "Installing Docker Compose Standalone"

# Install the latest Docker Compose standalone (in addition to plugin)
DOCKER_COMPOSE_VERSION=$(curl -s https://api.github.com/repos/docker/compose/releases/latest | grep '"tag_name":' | sed -E 's/.*"([^"]+)".*/\1/')
sudo curl -L "https://github.com/docker/compose/releases/download/${DOCKER_COMPOSE_VERSION}/docker-compose-$(uname -s)-$(uname -m)" -o /usr/local/bin/docker-compose
sudo chmod +x /usr/local/bin/docker-compose

# Verify Docker Compose installation
docker-compose --version
docker compose version
print_status "Docker Compose installed successfully"

# =============================================================================
# Summary
# =============================================================================
print_header "Installation Complete!"

echo "Installed versions:"
echo "-------------------"
echo -e "Git:            $(git --version)"
echo -e "NVM:            $(nvm --version 2>/dev/null || echo 'Run: source ~/.bashrc')"
echo -e "Node.js:        $(node --version 2>/dev/null || echo 'Run: source ~/.bashrc')"
echo -e "npm:            $(npm --version 2>/dev/null || echo 'Run: source ~/.bashrc')"
echo -e "Docker:         $(sudo docker --version)"
echo -e "Docker Compose: $(docker-compose --version)"
echo ""
print_warning "IMPORTANT: Log out and log back in, or run 'newgrp docker' to use Docker without sudo"
print_warning "Also run 'source ~/.bashrc' or restart your terminal to use NVM/Node.js"
echo ""
print_status "Setup completed successfully! 🚀"
