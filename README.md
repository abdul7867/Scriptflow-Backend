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

## ManyChat Webhook Integration

### Payload Structure
Configure your ManyChat External Request to send:

```json
{
  "subscriber_id": "{{user_id}}",
  "reel_url": "{{cuf_14126356}}",
  "user_idea": "{{cuf_14126358}}",
  "platform": "instagram"
}
```

### Pull-Based Delivery (Avoids Meta 24hr Blocks)
Create these custom fields in ManyChat:

| Field Name | Purpose |
|------------|---------|
| `sc_status` | Status: "Processing", "Ready", "Error" |
| `sc_last_script` | Generated script text |
| `sc_last_image` | ImgBB URL to script image |

Add field IDs to your `.env`:
```env
MANYCHAT_SC_STATUS_FIELD_ID=your_field_id
MANYCHAT_SC_LAST_SCRIPT_FIELD_ID=your_field_id
MANYCHAT_SC_LAST_IMAGE_FIELD_ID=your_field_id
```

### ManyChat Rule Setup
Create a Rule in ManyChat:
- **Trigger**: Custom Field Changed → `sc_status` equals "Ready"
- **Action**: Send message with script image from `sc_last_image`

**CRITICAL**: Do NOT use `message_tag` or `triggerFlow` to avoid 400 errors!

## Endpoints

### POST /api/v1/webhook
ManyChat webhook endpoint - handles all script generation requests.

### POST /api/v1/script/generate
Legacy endpoint for direct API calls.

Body:
```json
{
  "manychat_user_id": "12345",
  "reel_url": "https://www.instagram.com/reel/xyz/",
  "user_idea": "Make it about coding"
}
```
