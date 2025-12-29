# ScriptFlow Backend

AI Backend for generating viral scripts from Instagram Reels, integrated with ManyChat.

## Tech Stack
- **Runtime**: Node.js + TypeScript (Express)
- **Database**: MongoDB (Mongoose)
- **Queue**: BullMQ + Redis
- **AI**: Google Vertex AI (Gemini 1.5 Flash)
- **Media**: yt-dlp + FFmpeg
- **Hosting**: ImgBB or AWS S3

## Quick Start

1. **Install Dependencies**
   ```bash
   npm install
   ```

2. **Environment Setup**
   - Copy `.env.example` to `.env`
   - Fill in required variables (see `ENV_VARIABLES.md`)
   - Place `gcp-service-account.json` in project root

3. **Run Locally**
   ```bash
   npm run dev
   ```

4. **Docker Deployment**
   ```bash
   docker-compose up
   ```
   
See `PRODUCTION_CHECKLIST.md` for full deployment guide.

## endpoints

### POST /api/v1/script/generate

Body:
```json
{
  "manychat_user_id": "12345",
  "reel_url": "https://www.instagram.com/reel/xyz/",
  "user_idea": "Make it about coding"
}
```
