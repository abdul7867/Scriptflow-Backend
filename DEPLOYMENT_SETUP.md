# ScriptFlow Deployment Setup Guide

Complete setup guide for deploying ScriptFlow on AWS EC2 or any Linux server.

---

## Quick Setup Checklist

Before running `docker-compose up --build -d`, ensure you have:

- [ ] `.env` file in your project root
- [ ] `secrets/` folder with required credential files
- [ ] `fonts/` folder with font files (for image generation)

---

## 📁 Required Directory Structure

```
scriptflow-backend/
├── .env                              # Environment variables (REQUIRED)
├── docker-compose.yml
├── Dockerfile.aws
├── fonts/                            # Font files for Satori
│   └── (font files)
├── secrets/                          # Sensitive files (REQUIRED)
│   ├── gcp-service-account.json      # GCP credentials (REQUIRED)
│   └── instagram_cookies.txt         # Instagram auth (OPTIONAL)
└── temp/                             # Auto-created for temp files
```

---

## 🔐 Step 1: Create the `.env` File

Create a `.env` file in your project root with these values:

```bash
cd ~/scriptflow-backend
nano .env
```

**Required variables (minimum for startup):**

```env
# ===========================================
# REQUIRED - App won't start without these
# ===========================================

# Server
PORT=3000
NODE_ENV=production

# MongoDB Atlas (get from https://cloud.mongodb.com)
MONGODB_URI=mongodb+srv://username:password@cluster.mongodb.net/scriptflow?retryWrites=true&w=majority

# Redis (get from https://upstash.com or use local Redis)
REDIS_URL=rediss://default:password@host.upstash.io:6379

# GCP Vertex AI (for Gemini)
GCP_PROJECT_ID=your-gcp-project-id
GCP_LOCATION=us-central1

# ManyChat Integration
MANYCHAT_API_KEY=your-manychat-api-key
MANYCHAT_SCRIPT_FIELD_ID=your-script-field-id

# Image Hosting (ImgBB or S3)
IMGBB_API_KEY=your-imgbb-api-key

# ===========================================
# OPTIONAL - Sensible defaults provided
# ===========================================

# Queue & Rate Limiting
QUEUE_CONCURRENCY=5
RATE_LIMIT_MAX=100
USER_RATE_LIMIT=10
MAX_BETA_USERS=100

# Analysis Mode (hybrid uses both audio + frames)
ANALYSIS_MODE=hybrid

# Admin API Key (for protected endpoints)
# Generate with: openssl rand -hex 32
ADMIN_API_KEY=

# Public URL (for copy links)
BASE_URL=http://your-server-ip:3000

# ===========================================
# AWS S3 (Alternative to ImgBB)
# ===========================================
# AWS_REGION=ap-south-1
# AWS_ACCESS_KEY_ID=
# AWS_SECRET_ACCESS_KEY=
# S3_BUCKET_NAME=
# IMAGE_PROVIDER=s3
```

---

## 🔑 Step 2: Set Up the Secrets Folder

Create the secrets directory and add your credential files:

```bash
# Create secrets directory
mkdir -p ~/scriptflow-backend/secrets

# Add GCP service account (copy from your local machine)
# Option A: Use scp from your local machine
scp secrets/gcp-service-account.json ubuntu@your-server:~/scriptflow-backend/secrets/

# Option B: Create manually with nano
nano ~/scriptflow-backend/secrets/gcp-service-account.json
# Paste your JSON content, save with Ctrl+O, exit with Ctrl+X

# (Optional) Add Instagram cookies
nano ~/scriptflow-backend/secrets/instagram_cookies.txt
```

**GCP Service Account JSON format:**
```json
{
  "type": "service_account",
  "project_id": "your-project-id",
  "private_key_id": "...",
  "private_key": "-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n",
  "client_email": "...",
  "client_id": "...",
  "auth_uri": "https://accounts.google.com/o/oauth2/auth",
  "token_uri": "https://oauth2.googleapis.com/token",
  "auth_provider_x509_cert_url": "https://www.googleapis.com/oauth2/v1/certs",
  "client_x509_cert_url": "..."
}
```

---

## 📝 Step 3: Set Up Fonts Folder

Copy the fonts folder to your server:

```bash
# From your local machine
scp -r fonts/ ubuntu@your-server:~/scriptflow-backend/fonts/
```

---

## 🚀 Step 4: Deploy with Docker Compose

```bash
cd ~/scriptflow-backend

# Build and start (production - uses external MongoDB Atlas + Upstash Redis)
docker-compose up --build -d

# Or for local development (with local MongoDB + Redis containers)
docker-compose --profile local up --build -d
```

---

## ✅ Step 5: Verify Deployment

```bash
# Check container status
docker-compose ps

# View application logs
docker-compose logs -f app

# Test health endpoint
curl http://localhost:3000/health
```

**Expected health response:**
```json
{
  "status": "healthy",
  "timestamp": "2026-01-09T00:00:00.000Z",
  ...
}
```

---

## 🔧 Troubleshooting

### Warning: Environment variables not set

```
WARN[0000] The "MONGODB_URI" variable is not set. Defaulting to a blank string.
```

**Cause:** The `.env` file is missing or not in the correct location.

**Fix:**
1. Ensure `.env` file exists in the same directory as `docker-compose.yml`
2. Check file permissions: `chmod 600 .env`
3. Verify content: `cat .env | head -20`

---

### Container exits immediately

```bash
docker-compose logs app
```

Common issues:
- **MongoDB connection failed:** Check `MONGODB_URI` format and network access
- **Redis connection failed:** Check `REDIS_URL` format and network access
- **GCP credentials error:** Verify `secrets/gcp-service-account.json` exists

---

### Permission denied on secrets

```bash
# Fix permissions
chmod 600 secrets/*
chown -R $USER:$USER secrets/
```

---

## 📋 Environment Variables Reference

| Variable | Required | Description |
|----------|----------|-------------|
| `MONGODB_URI` | ✅ | MongoDB Atlas connection string |
| `REDIS_URL` | ✅ | Redis (Upstash) connection string |
| `GCP_PROJECT_ID` | ✅ | Google Cloud project ID |
| `MANYCHAT_API_KEY` | ✅ | ManyChat API key |
| `MANYCHAT_SCRIPT_FIELD_ID` | ✅ | ManyChat custom field ID for scripts |
| `IMGBB_API_KEY` | ⚠️ | Required if using ImgBB for images |
| `GCP_LOCATION` | ❌ | Default: `us-central1` |
| `QUEUE_CONCURRENCY` | ❌ | Default: `5` |
| `RATE_LIMIT_MAX` | ❌ | Default: `100` |
| `ADMIN_API_KEY` | ⚠️ | Required in production for admin endpoints |

---

## 🔄 Updating the Application

```bash
cd ~/scriptflow-backend

# Pull latest code
git pull origin main

# Rebuild and restart
docker-compose up --build -d

# Verify
docker-compose logs -f app
```

---

## 📊 Monitoring

```bash
# Live logs
docker-compose logs -f app

# Container stats
docker stats

# Check disk usage
df -h

# Check temp folder size
du -sh temp/
```
