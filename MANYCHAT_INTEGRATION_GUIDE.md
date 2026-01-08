# ManyChat Integration Guide for ScriptFlow

**Document Version**: 1.0  
**Created**: January 7, 2026  
**Author**: ScriptFlow Team  
**Status**: Active  

---

## 📋 Table of Contents

1. [Overview](#1-overview)
2. [Prerequisites](#2-prerequisites)
3. [Integration Architecture](#3-integration-architecture)
4. [Step-by-Step Integration Flow](#4-step-by-step-integration-flow)
5. [ManyChat Setup](#5-manychat-setup)
6. [Backend Configuration](#6-backend-configuration)
7. [Webhook Implementation](#7-webhook-implementation)
8. [Flow Building Guide](#8-flow-building-guide)
9. [Testing & Debugging](#9-testing--debugging)
10. [Production Deployment](#10-production-deployment)
11. [Troubleshooting](#11-troubleshooting)
12. [Best Practices](#12-best-practices)

---

## 1. Overview

### 1.1 What is ManyChat?

ManyChat is a chat marketing platform that enables businesses to automate conversations on Instagram, Facebook Messenger, WhatsApp, and SMS. ScriptFlow uses ManyChat as the primary user interface for receiving reel URLs and delivering generated scripts.

### 1.2 Integration Purpose

| Component | Role |
|-----------|------|
| **ManyChat** | User interface - receives messages, triggers webhooks, displays responses |
| **ScriptFlow Backend** | Processing engine - handles webhooks, generates scripts, returns results |
| **User Interaction** | Send reel URL → Receive AI-generated script as carousel |

### 1.3 Supported Platforms

- ✅ Instagram DMs (Primary)
- ✅ Facebook Messenger
- ⬜ WhatsApp (Future)
- ⬜ SMS (Future)

---

## 2. Prerequisites

### 2.1 Accounts Required

| Account | Purpose | Link |
|---------|---------|------|
| **ManyChat Pro** | Chat automation (Pro required for webhooks) | [manychat.com](https://manychat.com) |
| **Meta Business Suite** | Instagram/Facebook connection | [business.facebook.com](https://business.facebook.com) |
| **Instagram Professional Account** | Business/Creator account for DM automation | Instagram Settings |
| **ScriptFlow Backend** | Deployed API server | Your server |

### 2.2 Technical Requirements

```plaintext
✅ ScriptFlow Backend deployed and accessible via HTTPS
✅ ManyChat Pro subscription (Free tier doesn't support external requests)
✅ Instagram account connected to ManyChat
✅ Verified Meta Business Account (for production)
✅ SSL certificate on your backend (HTTPS required)
```

### 2.3 Environment Variables Needed

```env
# ManyChat Configuration
MANYCHAT_API_URL=https://api.manychat.com
MANYCHAT_ACCESS_TOKEN=your_manychat_api_token

# Backend URLs
BACKEND_URL=https://your-domain.com
WEBHOOK_SECRET=your_webhook_secret

# ManyChat Flow IDs (obtained after creating flows)
MANYCHAT_SUCCESS_FLOW_ID=content1234567890
MANYCHAT_ERROR_FLOW_ID=content0987654321
```

---

## 3. Integration Architecture

### 3.1 High-Level Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              USER JOURNEY                                    │
└─────────────────────────────────────────────────────────────────────────────┘

   ┌──────────┐         ┌──────────────┐         ┌────────────────────┐
   │   User   │ ──DM──▶ │   Instagram  │ ──API──▶│     ManyChat       │
   │          │         │              │         │   Automation       │
   └──────────┘         └──────────────┘         └─────────┬──────────┘
                                                           │
                                                           │ Webhook POST
                                                           ▼
                                           ┌───────────────────────────────┐
                                           │     ScriptFlow Backend        │
                                           │                               │
                                           │  ┌─────────────────────────┐  │
                                           │  │   1. Validate Request   │  │
                                           │  │   2. Detect Flow Type   │  │
                                           │  │   3. Queue Job          │  │
                                           │  └───────────┬─────────────┘  │
                                           │              │                │
                                           │              ▼                │
                                           │  ┌─────────────────────────┐  │
                                           │  │   4. Process Video      │  │
                                           │  │   5. Generate Script    │  │
                                           │  │   6. Create Carousel    │  │
                                           │  └───────────┬─────────────┘  │
                                           │              │                │
                                           └──────────────┼────────────────┘
                                                          │
                                                          │ ManyChat API Call
                                                          ▼
                                           ┌───────────────────────────────┐
                                           │   ManyChat Send Message       │
                                           │   (Carousel + Copy Link)      │
                                           └───────────────┬───────────────┘
                                                           │
                                                           ▼
                                                    ┌──────────┐
                                                    │   User   │
                                                    │ Receives │
                                                    │  Script  │
                                                    └──────────┘
```

### 3.2 Data Flow Sequence

```
1. USER         → Sends Instagram DM with reel URL
2. INSTAGRAM    → Forwards message to ManyChat
3. MANYCHAT     → Triggers automation flow
4. MANYCHAT     → Sends POST webhook to ScriptFlow
5. SCRIPTFLOW   → Validates & queues request
6. SCRIPTFLOW   → Returns immediate "Processing" response
7. MANYCHAT     → Shows "Generating your script..." message
8. SCRIPTFLOW   → (Background) Processes video, generates script
9. SCRIPTFLOW   → Calls ManyChat API to send result
10. USER        → Receives carousel with script
```

---

## 4. Step-by-Step Integration Flow

### 📅 PHASE 1: Account Setup (Day 1)

| Step | Action | Time Est. | Status |
|------|--------|-----------|--------|
| 1.1 | Create ManyChat account | 10 min | ⬜ |
| 1.2 | Upgrade to ManyChat Pro | 5 min | ⬜ |
| 1.3 | Connect Instagram account | 15 min | ⬜ |
| 1.4 | Verify Meta Business account | 30 min | ⬜ |
| 1.5 | Get ManyChat API token | 5 min | ⬜ |

### 📅 PHASE 2: Backend Preparation (Day 1-2)

| Step | Action | Time Est. | Status |
|------|--------|-----------|--------|
| 2.1 | Deploy ScriptFlow backend | 2 hrs | ⬜ |
| 2.2 | Configure environment variables | 30 min | ⬜ |
| 2.3 | Set up webhook endpoint | 1 hr | ⬜ |
| 2.4 | Test webhook locally (ngrok) | 30 min | ⬜ |
| 2.5 | Deploy to production with HTTPS | 1 hr | ⬜ |

### 📅 PHASE 3: ManyChat Flow Setup (Day 2-3)

| Step | Action | Time Est. | Status |
|------|--------|-----------|--------|
| 3.1 | Create main automation flow | 1 hr | ⬜ |
| 3.2 | Set up keyword triggers | 30 min | ⬜ |
| 3.3 | Configure external request action | 1 hr | ⬜ |
| 3.4 | Build success response flow | 1 hr | ⬜ |
| 3.5 | Build error handling flow | 30 min | ⬜ |

### 📅 PHASE 4: Testing (Day 3-4)

| Step | Action | Time Est. | Status |
|------|--------|-----------|--------|
| 4.1 | Test with personal Instagram | 2 hrs | ⬜ |
| 4.2 | Test all flow types (Instant, Guided, Copy) | 2 hrs | ⬜ |
| 4.3 | Test error scenarios | 1 hr | ⬜ |
| 4.4 | Test rate limiting | 30 min | ⬜ |
| 4.5 | User acceptance testing | 2 hrs | ⬜ |

### 📅 PHASE 5: Production Launch (Day 5)

| Step | Action | Time Est. | Status |
|------|--------|-----------|--------|
| 5.1 | Enable automation for all users | 15 min | ⬜ |
| 5.2 | Set up monitoring/alerts | 1 hr | ⬜ |
| 5.3 | Document support procedures | 1 hr | ⬜ |
| 5.4 | Launch announcement | 30 min | ⬜ |

---

## 5. ManyChat Setup

### 5.1 Creating a ManyChat Account

1. **Go to** [manychat.com](https://manychat.com)
2. **Sign up** with your email or Facebook
3. **Choose** Instagram as your primary channel
4. **Upgrade** to Pro plan ($15/month) - Required for webhooks

### 5.2 Connecting Instagram

```plaintext
ManyChat Dashboard → Settings → Channels → Instagram

Requirements:
✅ Instagram Professional Account (Creator or Business)
✅ Connected to a Facebook Page
✅ Logged into Facebook in the same browser
```

**Step-by-step:**

1. In ManyChat, go to **Settings** → **Channels**
2. Click **Connect Instagram**
3. Log in to Facebook (if not already)
4. Select your Instagram Professional account
5. Grant all requested permissions
6. Verify connection by sending test DM

### 5.3 Getting ManyChat API Token

```plaintext
ManyChat Dashboard → Settings → API → Get API Token
```

1. Navigate to **Settings** → **API**
2. Click **Get API Token**
3. Copy the token and store securely
4. Add to your `.env` file as `MANYCHAT_ACCESS_TOKEN`

```env
MANYCHAT_ACCESS_TOKEN=12345678:AbCdEfGhIjKlMnOpQrStUvWxYz
```

---

## 6. Backend Configuration

### 6.1 Required Packages

```json
// package.json dependencies
{
  "dependencies": {
    "express": "^4.18.2",
    "axios": "^1.6.0",
    "bullmq": "^4.12.0",
    "mongoose": "^8.0.0"
  }
}
```

### 6.2 Environment Configuration

```env
# .env file

# Server
PORT=3000
NODE_ENV=production
BACKEND_URL=https://your-domain.com

# ManyChat
MANYCHAT_API_URL=https://api.manychat.com
MANYCHAT_ACCESS_TOKEN=your_token_here

# Security
WEBHOOK_SECRET=random_secure_string_32_chars

# Database
MONGODB_URI=mongodb://localhost:27017/scriptflow
REDIS_URL=redis://localhost:6379
```

### 6.3 ManyChat Service Implementation

Create `src/services/manychatService.ts`:

```typescript
import axios from 'axios';

interface ManyChatConfig {
  apiUrl: string;
  accessToken: string;
}

interface SendMessageOptions {
  subscriberId: string;
  flowId?: string;
  text?: string;
  carouselImages?: string[];
  buttons?: Array<{
    type: 'url' | 'flow';
    caption: string;
    url?: string;
    flowId?: string;
  }>;
}

class ManyChatService {
  private config: ManyChatConfig;
  private client: axios.AxiosInstance;

  constructor() {
    this.config = {
      apiUrl: process.env.MANYCHAT_API_URL || 'https://api.manychat.com',
      accessToken: process.env.MANYCHAT_ACCESS_TOKEN || '',
    };

    this.client = axios.create({
      baseURL: this.config.apiUrl,
      headers: {
        'Authorization': `Bearer ${this.config.accessToken}`,
        'Content-Type': 'application/json',
      },
    });
  }

  /**
   * Send a message to a subscriber
   */
  async sendMessage(options: SendMessageOptions): Promise<void> {
    const { subscriberId, text, carouselImages, buttons } = options;

    const payload = {
      subscriber_id: subscriberId,
      data: {
        version: 'v2',
        content: {
          messages: [] as any[],
        },
      },
    };

    // Add text message
    if (text) {
      payload.data.content.messages.push({
        type: 'text',
        text: text,
      });
    }

    // Add carousel (gallery)
    if (carouselImages && carouselImages.length > 0) {
      payload.data.content.messages.push({
        type: 'cards',
        elements: carouselImages.map((imageUrl, index) => ({
          title: index === 0 ? '🎬 Your Script' : `Card ${index + 1}`,
          image_url: imageUrl,
          buttons: buttons || [],
        })),
      });
    }

    await this.client.post('/fb/sending/sendContent', payload);
  }

  /**
   * Trigger a specific flow for a subscriber
   */
  async triggerFlow(subscriberId: string, flowId: string, customFields?: Record<string, any>): Promise<void> {
    const payload = {
      subscriber_id: subscriberId,
      flow_ns: flowId,
    };

    // Set custom fields if provided
    if (customFields) {
      await this.setCustomFields(subscriberId, customFields);
    }

    await this.client.post('/fb/sending/sendFlow', payload);
  }

  /**
   * Set custom fields for a subscriber
   */
  async setCustomFields(subscriberId: string, fields: Record<string, any>): Promise<void> {
    const payload = {
      subscriber_id: subscriberId,
      fields: Object.entries(fields).map(([name, value]) => ({
        field_name: name,
        field_value: value,
      })),
    };

    await this.client.post('/fb/subscriber/setCustomFields', payload);
  }

  /**
   * Get subscriber info
   */
  async getSubscriber(subscriberId: string): Promise<any> {
    const response = await this.client.get(`/fb/subscriber/getInfo`, {
      params: { subscriber_id: subscriberId },
    });
    return response.data;
  }

  /**
   * Send typing indicator
   */
  async sendTypingIndicator(subscriberId: string): Promise<void> {
    await this.client.post('/fb/sending/sendTyping', {
      subscriber_id: subscriberId,
    });
  }
}

export const manyChatService = new ManyChatService();
```

---

## 7. Webhook Implementation

### 7.1 Webhook Endpoint Setup

Create or update `src/routes/webhook.ts`:

```typescript
import { Router, Request, Response } from 'express';
import { validateManyChatRequest } from '../middleware/webhookAuth';
import { scriptQueue } from '../queues/scriptQueue';
import { detectFlow } from '../utils/triggerDetector';

const router = Router();

/**
 * ManyChat Webhook Endpoint
 * POST /api/webhook/manychat
 */
router.post('/manychat', validateManyChatRequest, async (req: Request, res: Response) => {
  try {
    const {
      subscriber_id,
      user_input,
      reel_url,
      custom_fields,
    } = req.body;

    // Validate required fields
    if (!subscriber_id) {
      return res.status(400).json({ error: 'subscriber_id is required' });
    }

    // Detect flow type (instant, guided, copy, variation)
    const flowType = detectFlow(user_input, reel_url);

    // Create job payload
    const jobPayload = {
      subscriberId: subscriber_id,
      userInput: user_input || '',
      reelUrl: reel_url || '',
      flowType,
      customFields: custom_fields || {},
      timestamp: new Date().toISOString(),
    };

    // Queue the job for processing
    const job = await scriptQueue.add('generate-script', jobPayload, {
      removeOnComplete: true,
      removeOnFail: false,
      attempts: 3,
      backoff: {
        type: 'exponential',
        delay: 1000,
      },
    });

    // Return immediate response to ManyChat
    return res.status(200).json({
      success: true,
      message: 'Processing started',
      jobId: job.id,
      flowType,
    });

  } catch (error) {
    console.error('Webhook error:', error);
    return res.status(500).json({
      success: false,
      error: 'Internal server error',
    });
  }
});

export default router;
```

### 7.2 Webhook Authentication Middleware

Create `src/middleware/webhookAuth.ts`:

```typescript
import { Request, Response, NextFunction } from 'express';
import crypto from 'crypto';

export function validateManyChatRequest(req: Request, res: Response, next: NextFunction) {
  // Option 1: Verify using a shared secret
  const webhookSecret = process.env.WEBHOOK_SECRET;
  const providedSecret = req.headers['x-webhook-secret'];

  if (webhookSecret && providedSecret !== webhookSecret) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  // Option 2: Verify request origin (ManyChat IPs)
  // const allowedIPs = ['52.1.x.x', '54.x.x.x']; // ManyChat server IPs
  // const clientIP = req.ip;
  // if (!allowedIPs.includes(clientIP)) {
  //   return res.status(403).json({ error: 'Forbidden' });
  // }

  next();
}
```

### 7.3 Response Delivery to ManyChat

After processing, send results back via ManyChat API:

```typescript
// In your worker or job processor
import { manyChatService } from '../services/manychatService';

async function deliverScriptToUser(jobData: any, result: any) {
  const { subscriberId } = jobData;
  const { carouselImages, copyPageUrl, scriptId } = result;

  try {
    // Set custom fields for ManyChat flows to use
    await manyChatService.setCustomFields(subscriberId, {
      last_script_id: scriptId,
      copy_page_url: copyPageUrl,
      script_generated_at: new Date().toISOString(),
    });

    // Send the carousel with script images
    await manyChatService.sendMessage({
      subscriberId,
      carouselImages,
      text: '✨ Your script is ready! Here\'s your 3-card carousel:',
      buttons: [
        {
          type: 'url',
          caption: '📋 Copy Script',
          url: copyPageUrl,
        },
        {
          type: 'flow',
          caption: '🔄 Get Another',
          flowId: process.env.MANYCHAT_VARIATION_FLOW_ID,
        },
      ],
    });

  } catch (error) {
    console.error('Failed to deliver script to ManyChat:', error);
    
    // Send error message to user
    await manyChatService.sendMessage({
      subscriberId,
      text: '❌ Sorry, something went wrong. Please try again or contact support.',
    });
  }
}
```

---

## 8. Flow Building Guide

### 8.1 Main Automation Flow

Create this flow in ManyChat:

```
Flow Name: ScriptFlow - Main Handler
Trigger: Comment in Instagram Post containing "script" OR DM containing any message

┌─────────────────────────────────────────┐
│  STARTING STEP                          │
│  Trigger: Any DM Message                │
└────────────────┬────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────┐
│  CONDITION: Check if contains reel URL  │
│  {{last_user_message}} contains         │
│  "instagram.com/reel"                   │
└────────────────┬────────────────────────┘
                 │
        ┌────────┴────────┐
        │                 │
        ▼ YES             ▼ NO
┌──────────────┐   ┌──────────────────────┐
│ External     │   │ Send Message:        │
│ Request      │   │ "Please send an      │
│ (Webhook)    │   │ Instagram Reel URL   │
└──────┬───────┘   │ to generate a script"│
       │           └──────────────────────┘
       ▼
┌─────────────────────────────────────────┐
│  Send Message: Processing...            │
│  "🔄 Analyzing your reel...             │
│   This usually takes 30-60 seconds"     │
└─────────────────────────────────────────┘
```

### 8.2 External Request Configuration

In ManyChat Flow Builder:

1. **Add Action** → **External Request**
2. Configure:

```yaml
Request Type: POST
URL: https://your-domain.com/api/webhook/manychat

Headers:
  - Content-Type: application/json
  - x-webhook-secret: {{your_webhook_secret}}

Body (JSON):
  {
    "subscriber_id": "{{subscriber_id}}",
    "user_input": "{{last_user_message}}",
    "reel_url": "{{last_user_message}}",
    "custom_fields": {
      "name": "{{first_name}}",
      "instagram_id": "{{instagram_user_id}}",
      "language": "{{locale}}"
    }
  }

Response Mapping:
  - jobId → Custom Field: last_job_id
  - flowType → Custom Field: last_flow_type
```

### 8.3 Success Response Flow

```
Flow Name: ScriptFlow - Success Handler
Trigger: API Call from Backend

┌─────────────────────────────────────────┐
│  GALLERY CARD                           │
│  Dynamic Images from Custom Fields      │
│                                         │
│  Image 1: {{carousel_image_1}}          │
│  Image 2: {{carousel_image_2}}          │
│  Image 3: {{carousel_image_3}}          │
│                                         │
│  Buttons:                               │
│  [📋 Copy Script] → URL: {{copy_url}}   │
│  [🔄 Another] → Trigger Variation Flow  │
└─────────────────────────────────────────┘
```

### 8.4 Error Handling Flow

```
Flow Name: ScriptFlow - Error Handler
Trigger: API Call from Backend

┌─────────────────────────────────────────┐
│  TEXT MESSAGE                           │
│  "❌ Oops! Something went wrong.        │
│                                         │
│   Error: {{error_message}}              │
│                                         │
│   Please try again or contact support." │
│                                         │
│  Buttons:                               │
│  [🔄 Try Again] → Restart Main Flow     │
│  [📩 Contact Support] → Support Flow    │
└─────────────────────────────────────────┘
```

### 8.5 Rate Limit Flow

```
Flow Name: ScriptFlow - Rate Limit
Trigger: API Response with rate_limited: true

┌─────────────────────────────────────────┐
│  TEXT MESSAGE                           │
│  "⏰ You've reached your limit!         │
│                                         │
│   Free users: 3 scripts/day             │
│   Pro users: Unlimited                  │
│                                         │
│   Upgrade to Pro for unlimited access!" │
│                                         │
│  Buttons:                               │
│  [⭐ Upgrade to Pro] → Upgrade Flow     │
│  [⏰ Check Time Left] → Show Reset Time │
└─────────────────────────────────────────┘
```

### 8.6 Variation/Redo Flow

```
Flow Name: ScriptFlow - Variation Handler
Trigger: Message contains "another", "redo", "again", "different"

┌─────────────────────────────────────────┐
│  CONDITION: Has previous script?        │
│  Check: {{last_script_id}} is not empty │
└────────────────┬────────────────────────┘
                 │
        ┌────────┴────────┐
        │                 │
        ▼ YES             ▼ NO
┌──────────────┐   ┌──────────────────────┐
│ External     │   │ Send Message:        │
│ Request      │   │ "I don't have a      │
│ (Variation)  │   │ previous script.     │
└──────┬───────┘   │ Send a reel URL      │
       │           │ first!"              │
       ▼           └──────────────────────┘
┌─────────────────────────────────────────┐
│  Send Message:                          │
│  "🔄 Creating another version...        │
│   Coming right up!"                     │
└─────────────────────────────────────────┘
```

### 8.7 Copy Mode Flow

```
Flow Name: ScriptFlow - Copy Mode
Trigger: Message contains "copy", "transcript", "exact"

┌─────────────────────────────────────────┐
│  External Request (Copy Mode)           │
│                                         │
│  Body:                                  │
│  {                                      │
│    "subscriber_id": "{{subscriber_id}}",│
│    "flow_type": "copy",                 │
│    "reel_url": "{{last_reel_url}}"      │
│  }                                      │
└────────────────┬────────────────────────┘
                 │
                 ▼
┌─────────────────────────────────────────┐
│  Send Message:                          │
│  "📝 Getting the exact transcript..."   │
└─────────────────────────────────────────┘
```

---

## 9. Testing & Debugging

### 9.1 Local Testing with ngrok

```bash
# Install ngrok
npm install -g ngrok

# Start your local server
npm run dev

# Expose local server to internet
ngrok http 3000

# Use the ngrok URL in ManyChat
# https://abc123.ngrok.io/api/webhook/manychat
```

### 9.2 Testing Checklist

| Test Case | Expected Result | Status |
|-----------|-----------------|--------|
| Send valid reel URL | Script generated, carousel sent | ⬜ |
| Send invalid URL | Error message displayed | ⬜ |
| Send text without URL | Prompt to send reel URL | ⬜ |
| Say "another" after script | Variation generated | ⬜ |
| Say "copy" | Exact transcript formatted | ⬜ |
| Request 11th script (hit rate limit) | Rate limit message | ⬜ |
| Backend down | Graceful error message | ⬜ |
| Send non-English reel | Script in same language | ⬜ |
| Specify tone (e.g., "make it funny") | Tone applied to script | ⬜ |
| Specify language (e.g., "in Spanish") | Script in requested language | ⬜ |

### 9.3 ManyChat Debugging Tools

1. **Flow Preview**: Test flows without sending real messages
   - Click "Preview" in Flow Builder
   - Simulate different user inputs
   
2. **Subscriber Timeline**: See all interactions with a user
   - Go to Audience → Search subscriber
   - View complete conversation history
   
3. **System Fields**: Check custom field values
   - Audience → Subscriber → Custom Fields tab
   
4. **External Request Logs**: View webhook responses
   - Settings → API → Request History

### 9.4 Backend Logging

Add comprehensive logging for debugging:

```typescript
import { createLogger, transports, format } from 'winston';

const logger = createLogger({
  level: 'info',
  format: format.combine(
    format.timestamp(),
    format.json()
  ),
  transports: [
    new transports.Console(),
    new transports.File({ filename: 'logs/manychat.log' })
  ],
});

// Structured logging for webhook requests
logger.info('ManyChat webhook received', {
  subscriberId: req.body.subscriber_id,
  hasReelUrl: !!req.body.reel_url,
  userInput: req.body.user_input?.substring(0, 50),
  timestamp: new Date().toISOString(),
});

// Log ManyChat API responses
logger.info('ManyChat message sent', {
  subscriberId,
  messageType: 'carousel',
  imagesCount: carouselImages.length,
  responseTime: Date.now() - startTime,
});
```

### 9.5 Manual API Testing

Test ManyChat API directly:

```bash
# Test sending a message
curl -X POST https://api.manychat.com/fb/sending/sendContent \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "subscriber_id": "12345",
    "data": {
      "version": "v2",
      "content": {
        "messages": [
          {"type": "text", "text": "Hello from API!"}
        ]
      }
    }
  }'
```

---

## 10. Production Deployment

### 10.1 Deployment Checklist

```plaintext
✅ Backend deployed with HTTPS
✅ Environment variables set in production
✅ MongoDB and Redis accessible
✅ ManyChat webhook URL updated to production URL
✅ Error monitoring configured (Sentry, etc.)
✅ Logging configured (CloudWatch, etc.)
✅ Rate limiting enabled
✅ Health check endpoint working
✅ SSL certificate valid and not expiring soon
✅ Backup and recovery procedures documented
```

### 10.2 Production Environment Setup

```env
# Production .env

NODE_ENV=production
PORT=3000
BACKEND_URL=https://api.scriptflow.app

# ManyChat
MANYCHAT_API_URL=https://api.manychat.com
MANYCHAT_ACCESS_TOKEN=production_token_here

# Security
WEBHOOK_SECRET=super_secure_random_string_64_chars

# Database
MONGODB_URI=mongodb+srv://user:pass@cluster.mongodb.net/scriptflow
REDIS_URL=redis://user:pass@redis-host:6379

# Monitoring
SENTRY_DSN=https://xxx@sentry.io/123
LOG_LEVEL=info
```

### 10.3 Health Check Endpoint

```typescript
// src/routes/health.ts
import { Router } from 'express';
import mongoose from 'mongoose';
import Redis from 'ioredis';
import axios from 'axios';

const router = Router();

async function checkMongoDB(): Promise<string> {
  try {
    await mongoose.connection.db.admin().ping();
    return 'ok';
  } catch {
    return 'error';
  }
}

async function checkRedis(): Promise<string> {
  try {
    const redis = new Redis(process.env.REDIS_URL);
    await redis.ping();
    redis.disconnect();
    return 'ok';
  } catch {
    return 'error';
  }
}

async function checkManyChat(): Promise<string> {
  try {
    await axios.get('https://api.manychat.com/fb/page/getInfo', {
      headers: {
        Authorization: `Bearer ${process.env.MANYCHAT_ACCESS_TOKEN}`,
      },
    });
    return 'ok';
  } catch {
    return 'error';
  }
}

router.get('/health', async (req, res) => {
  const health = {
    status: 'ok',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
    services: {
      mongodb: await checkMongoDB(),
      redis: await checkRedis(),
      manychat: await checkManyChat(),
    },
  };
  
  const allHealthy = Object.values(health.services).every(s => s === 'ok');
  res.status(allHealthy ? 200 : 503).json(health);
});

export default router;
```

### 10.4 Monitoring Alerts

Set up alerts for:

| Alert | Threshold | Action |
|-------|-----------|--------|
| Webhook latency | > 5 seconds | Investigate backend |
| Error rate | > 5% | Check logs, rollback if needed |
| ManyChat API failures | > 3 in 5 min | Check API token, rate limits |
| Queue backlog | > 100 jobs | Scale workers |
| Memory usage | > 85% | Scale or optimize |
| Disk space | < 10% | Clear logs, expand storage |

### 10.5 Scaling Considerations

```plaintext
Horizontal Scaling:
├── API Servers (stateless, load balanced)
├── Worker Processes (can be scaled independently)
├── Redis Cluster (for queue and caching)
└── MongoDB Replica Set (for data durability)

Recommended for 1000+ daily users:
- 2-3 API server instances
- 2-4 worker processes
- Redis with 1GB+ memory
- MongoDB Atlas M10 or higher
```

---

## 11. Troubleshooting

### 11.1 Common Issues & Solutions

#### Issue: "Webhook not receiving requests"

**Symptoms**: ManyChat shows "External Request Failed"

**Solutions**:
1. Verify URL is HTTPS and accessible
2. Check firewall allows incoming requests
3. Verify webhook secret matches
4. Test URL directly with curl:
```bash
curl -X POST https://your-domain.com/api/webhook/manychat \
  -H "Content-Type: application/json" \
  -H "x-webhook-secret: your_secret" \
  -d '{"subscriber_id": "test", "user_input": "test"}'
```

#### Issue: "Carousel images not showing"

**Symptoms**: User receives text but no images

**Solutions**:
1. Verify image URLs are publicly accessible
2. Check image format (JPG, PNG supported)
3. Verify image size < 8MB
4. Use HTTPS image URLs
5. Test image URL in browser

#### Issue: "Rate limit errors from ManyChat API"

**Symptoms**: 429 Too Many Requests

**Solutions**:
1. Implement request throttling
2. Batch messages when possible
3. Cache subscriber data
4. Contact ManyChat for rate limit increase
5. Add exponential backoff to retries

#### Issue: "Messages sent but user doesn't receive"

**Symptoms**: API returns success but no message

**Solutions**:
1. Check subscriber is still subscribed
2. Verify Instagram connection still active
3. Check 24-hour messaging window (Meta policy)
4. Look for errors in ManyChat subscriber timeline
5. Verify page permissions in Meta Business Suite

#### Issue: "24-hour window expired"

**Symptoms**: Cannot send messages to user after 24 hours

**Solutions**:
1. This is a Meta policy limitation
2. Use ManyChat's Recurring Notification feature (requires user opt-in)
3. Prompt users to send a message to restart the window
4. Design flows to complete within 24 hours

#### Issue: "Script delivery delayed"

**Symptoms**: Users waiting too long for scripts

**Solutions**:
1. Check queue backlog
2. Scale worker processes
3. Optimize video processing
4. Add caching for repeated reels
5. Implement priority queue for Pro users

### 11.2 Debug Mode

Enable debug mode for detailed logging:

```typescript
// Add to .env
DEBUG_MODE=true
LOG_LEVEL=debug

// In your code
if (process.env.DEBUG_MODE === 'true') {
  console.log('Webhook payload:', JSON.stringify(req.body, null, 2));
  console.log('ManyChat response:', JSON.stringify(response.data, null, 2));
}
```

### 11.3 Emergency Procedures

```plaintext
If ManyChat Integration Fails:

1. IMMEDIATE: Check API token validity
   - Go to ManyChat → Settings → API
   - Generate new token if needed

2. CHECK: Backend health
   - Visit /health endpoint
   - Review recent logs

3. VERIFY: Instagram connection
   - ManyChat → Settings → Channels
   - Reconnect if "Disconnected"

4. FALLBACK: Send manual notification
   - Use ManyChat Broadcast to notify users
   - "We're experiencing issues, please try again later"

5. ESCALATE: Contact support
   - ManyChat: support@manychat.com
   - Meta Business Help: business.facebook.com/help
```

---

## 12. Best Practices

### 12.1 Performance Optimization

| Practice | Implementation |
|----------|----------------|
| **Async Processing** | Return 200 immediately, process in background |
| **Message Batching** | Send carousel and text in single API call |
| **Caching** | Cache subscriber info, reduce API calls |
| **Connection Pooling** | Reuse HTTP connections for ManyChat API |
| **Queue Prioritization** | Process Pro users before free users |

### 12.2 User Experience

| Practice | Implementation |
|----------|----------------|
| **Quick Acknowledgment** | Send "Processing..." immediately (< 2 seconds) |
| **Progress Updates** | Optional: "Almost done..." messages for long waits |
| **Clear Error Messages** | Tell user what went wrong and how to fix |
| **Retry Guidance** | Always provide "Try Again" button |
| **Helpful Prompts** | Guide users on what to do next |

### 12.3 Security

| Practice | Implementation |
|----------|----------------|
| **Webhook Authentication** | Verify shared secret on every request |
| **Input Validation** | Sanitize all user input |
| **Rate Limiting** | Prevent abuse and protect API costs |
| **Token Rotation** | Rotate ManyChat tokens quarterly |
| **HTTPS Only** | Never use HTTP for webhooks |
| **Environment Variables** | Never commit tokens to git |

### 12.4 Maintenance

| Practice | Implementation |
|----------|----------------|
| **Regular Testing** | Weekly test of all flows |
| **Token Refresh** | Check token validity monthly |
| **Documentation** | Keep this doc updated |
| **Monitoring** | Review alerts and metrics daily |
| **Backup** | Regular database backups |
| **Updates** | Keep dependencies updated |

### 12.5 ManyChat-Specific Best Practices

| Practice | Why It Matters |
|----------|----------------|
| **Use Custom Fields** | Store state between interactions |
| **Tag Subscribers** | Segment users for targeted messaging |
| **Use Conditions** | Route users based on their status |
| **Test Before Publish** | Use flow preview to catch errors |
| **Keep Flows Simple** | Complex flows are hard to debug |
| **Use Keywords Carefully** | Avoid triggering wrong flows |

---

## 📞 Support & Resources

### ManyChat Resources
- [ManyChat Documentation](https://support.manychat.com/)
- [ManyChat API Reference](https://api.manychat.com/)
- [ManyChat Community](https://community.manychat.com/)
- [ManyChat Status Page](https://status.manychat.com/)

### Instagram/Meta Resources
- [Instagram Graph API](https://developers.facebook.com/docs/instagram-api/)
- [Messenger Platform](https://developers.facebook.com/docs/messenger-platform/)
- [Meta Business Help](https://www.facebook.com/business/help)

### ScriptFlow Internal
- Backend Repository: `/src`
- Environment Template: `.env.example`
- Docker Compose: `docker-compose.yml`
- Deployment Guide: `/deployment`

---

## 📝 Change Log

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | Jan 7, 2026 | ScriptFlow Team | Initial documentation |

---

*This document should be updated whenever ManyChat integration changes are made.*
