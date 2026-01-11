# Secrets Folder

This folder contains sensitive files that should **NEVER** be committed to version control.

## Required Files

### 1. `gcp-service-account.json` (REQUIRED)

Your Google Cloud Platform service account credentials for Vertex AI.

**How to get it:**
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Navigate to IAM & Admin > Service Accounts
3. Create or select a service account with Vertex AI permissions
4. Click "Keys" > "Add Key" > "Create new key" (JSON format)
5. Save the downloaded file as `gcp-service-account.json` in this folder

**Required for:**
- Video analysis using Vertex AI Gemini models
- Script generation AI features

**Project ID:** `abdul-content-creation` (as specified in your service account)

---

### 2. `instagram_cookies.txt` (OPTIONAL)

Instagram authentication cookies for downloading private videos.

**How to get it:**
1. Install browser extension: "Get cookies.txt LOCALLY"
2. Login to Instagram in your browser
3. Export cookies for instagram.com
4. Save as `instagram_cookies.txt` in this folder

**Format:** Netscape cookie format

**Required for:**
- Downloading age-restricted Instagram content
- Accessing private Instagram videos

---

## File Structure

```
secrets/
├── .gitkeep                      # Keeps folder in git (empty)
├── README.md                     # This file
├── gcp-service-account.json      # GCP credentials (REQUIRED) - NOT IN GIT
└── instagram_cookies.txt         # Instagram cookies (OPTIONAL) - NOT IN GIT
```

## Security Notes

⚠️ **NEVER commit these files to version control!**

✅ **These files are protected by `.gitignore`:**
- `secrets/` folder is excluded (except .gitkeep and README.md)
- `*-service-account*.json` pattern is explicitly blocked
- `*_cookies.txt` pattern is explicitly blocked

✅ **File permissions:**
```bash
chmod 600 secrets/gcp-service-account.json
chmod 600 secrets/instagram_cookies.txt
```

## Setup Instructions

### Local Development

```bash
# 1. Copy your GCP service account JSON
cp /path/to/your-service-account.json secrets/gcp-service-account.json

# 2. (Optional) Add Instagram cookies
cp /path/to/instagram_cookies.txt secrets/instagram_cookies.txt

# 3. Update .env file
cp .env.example .env
nano .env  # Set GCP_PROJECT_ID=abdul-content-creation

# 4. Set proper permissions
chmod 600 secrets/*.json secrets/*.txt
```

### Docker / Production

The `docker-compose.yml` automatically mounts the secrets folder:

```yaml
volumes:
  - ./secrets:/app/secrets:ro  # Read-only mount
```

**Environment variables in container:**
- `GOOGLE_APPLICATION_CREDENTIALS=/app/secrets/gcp-service-account.json`
- `INSTAGRAM_COOKIES_PATH=/app/secrets/instagram_cookies.txt`

### AWS Deployment

```bash
# 1. Upload GCP service account to AWS server
scp secrets/gcp-service-account.json ubuntu@YOUR_AWS_IP:~/scriptflow-backend/secrets/

# 2. (Optional) Upload Instagram cookies
scp secrets/instagram_cookies.txt ubuntu@YOUR_AWS_IP:~/scriptflow-backend/secrets/

# 3. Set permissions on AWS
ssh ubuntu@YOUR_AWS_IP
cd ~/scriptflow-backend
chmod 600 secrets/*.json secrets/*.txt
```

## Troubleshooting

### Error: "GCP_PROJECT_ID environment variable is not set"

**Solution:**
1. Create `.env` file from template: `cp .env.example .env`
2. Set `GCP_PROJECT_ID=abdul-content-creation`
3. Restart application

### Error: "GOOGLE_APPLICATION_CREDENTIALS file not found"

**Solution:**
1. Ensure file exists: `ls -la secrets/gcp-service-account.json`
2. Verify it's valid JSON: `cat secrets/gcp-service-account.json | python3 -m json.tool`
3. Check file permissions: `chmod 600 secrets/gcp-service-account.json`

### Error: "Unable to infer your project"

**Solution:**
1. Verify `project_id` field in `secrets/gcp-service-account.json`
2. Ensure it matches `GCP_PROJECT_ID` in `.env` file
3. Restart application to reload credentials

## Related Files

- `.env.example` - Environment variable template
- `.gitignore` - Excludes secrets from version control
- `docker-compose.yml` - Mounts secrets folder
- `Dockerfile.aws` - Creates secrets directory structure

## Support

For issues with:
- **GCP Service Account:** Check Google Cloud Console permissions
- **Instagram Cookies:** Re-export cookies from browser
- **File Permissions:** Run `chmod 600 secrets/*.json secrets/*.txt`
- **Docker Mounts:** Verify `docker-compose.yml` volumes section
