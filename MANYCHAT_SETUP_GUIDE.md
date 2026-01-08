# ScriptFlow ManyChat Setup Guide
## Simple Step-by-Step Setup for ManyChat Automation

---

## 📌 The Simple Approach

**ONE flow in ManyChat. ALL logic in backend.**

ManyChat only does ONE thing: Forward ALL messages to your backend.
The backend handles everything: intent detection, keywords, state management, responses, delivery.

---

## 📌 Quick Reference Card

| Item | Value |
|------|-------|
| **Webhook URL** | `https://your-domain.com/api/v3/webhook` |
| **Method** | POST |
| **Content-Type** | application/json |
| **ManyChat Setup** | Settings → Instagram → Default Reply |
| **Trigger Frequency** | Every time |

---

## 🔧 STEP 1: Create Custom Fields in ManyChat

Go to **Settings → Custom Fields** and create these fields:

### Required Custom Fields

| Field Name | Type | Description |
|------------|------|-------------|
| `script_image_url` | Text | URL of generated script image |
| `script_copy_url` | Text | URL to copy script text |

**To create a field:**
1. ManyChat → Settings → Custom Fields
2. Click "+ New Custom Field"
3. Enter name and select type
4. Click Save
5. **Copy the Field ID** (you'll need it for `.env`)

---

## 🔧 STEP 2: Get ManyChat API Token

1. Go to **Settings → API**
2. Click **"Get API Token"**
3. Copy the token
4. Add to your `.env` file:

```env
MANYCHAT_API_KEY=your_token_here
MANYCHAT_SCRIPT_FIELD_ID=12345      # Get from Custom Fields
MANYCHAT_COPY_FIELD_ID=12346        # Get from Custom Fields
MANYCHAT_ENABLE_DIRECT_MESSAGING=true
```

---

## 🔧 STEP 3: Set Up Default Reply (The Catch-All)

ManyChat's **Default Reply** catches ALL messages that don't match any keyword trigger.
Since we're not creating keyword triggers, it catches EVERYTHING!

### How to Set Up Default Reply

1. Go to **ManyChat Dashboard**
2. Click **Settings** (left sidebar)
3. Click **Instagram** (under Channels)
4. Scroll to **"Default Reply"** section
5. Click **"Create New"** or **"Select Existing Flow"**

### Configure the Default Reply Flow

**In the Flow Builder:**

1. **Set Trigger Settings:**
   - Trigger frequency: **"Every time"** (NOT "Once every 24 hours")
   - Skip story replies: **ON** (optional)

2. **Add External Request Action:**
   - Click **"+ Add Action"**
   - Select **"External Request"**
   - Configure:

```
┌─────────────────────────────────────────────────────────────────┐
│  EXTERNAL REQUEST SETTINGS                                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                 │
│  Request Type: POST                                             │
│                                                                 │
│  URL: https://your-domain.com/api/v3/webhook                   │
│                                                                 │
│  Headers:                                                       │
│    Content-Type: application/json                               │
│                                                                 │
│  Body (paste this exactly):                                     │
│  {                                                              │
│    "subscriber_id": "{{psid}}",                                │
│    "user_idea": "{{last_input_text}}",                         │
│    "language_hint": "{{locale}}",                              │
│    "source": "user"                                            │
│  }                                                              │
│                                                                 │
│  Response Mapping: None (backend sends responses directly)      │
│                                                                 │
└─────────────────────────────────────────────────────────────────┘
```

3. **Set Live:**
   - Click **"Set Live"** button (bottom left)
   - Confirm activation

### ✅ That's It!

Now every DM your Instagram receives will be forwarded to your backend.
The backend handles all the logic - no keyword triggers needed in ManyChat!

---

## 📤 WEBHOOK REQUEST BODY

Copy this exact JSON for the External Request body:

```json
{
  "subscriber_id": "{{psid}}",
  "user_idea": "{{last_input_text}}",
  "language_hint": "{{locale}}",
  "source": "user"
}
```

### Field Descriptions

| Field | Required | Description |
|-------|----------|-------------|
| `subscriber_id` | ✅ YES | ManyChat subscriber ID (`{{psid}}`) |
| `user_idea` | ✅ YES | The user's message (`{{last_input_text}}`) |
| `language_hint` | ❌ No | User's language (`{{locale}}`) |
| `source` | ❌ No | Always "user" for loop prevention |

---

## 🧠 What the Backend Handles

### Intent Detection

The backend automatically detects user intent:

| User Message | Intent Detected | Action |
|--------------|-----------------|--------|
| Contains `instagram.com/reel` | `NEW_REEL` | Process reel |
| "redo", "another", "again" | `VARIATION` | Create new version |
| "copy", "link", "share" | `COPY` | Send copy link (generated script) |
| "extract", "original", "transcript" | `EXTRACT_ORIGINAL` | Get exact words from video |
| "hi", "hello", "help" | `HELP` | Send welcome message |
| Plain text (after sending reel) | `SUBMIT_IDEA` | Process as user's idea |
| Anything else | `INVALID` | Send help message |

### State Management

Backend tracks each user's conversation state:

| State | Meaning | Valid Actions |
|-------|---------|---------------|
| `IDLE` | No active conversation | Send reel, say help |
| `AWAITING_IDEA` | Reel received, waiting for idea | Send idea, send new reel |
| `PROCESSING` | Script being generated | Wait |
| `AWAITING_FEEDBACK` | Script delivered | Say copy, another, or new reel |
| `ERROR` | Something went wrong | Send new reel |

### Delivery

The backend **sends responses directly** via ManyChat API:
- ✅ Script image sent automatically
- ✅ Copy link sent automatically
- ✅ Error messages sent automatically
- ✅ Prompts sent automatically

**ManyChat doesn't need to do anything with the webhook response!**

---

## 🔄 User Flows

### Flow 1: Reel + Idea Together

```
User: https://instagram.com/reel/ABC123 make it funny for fitness
      ↓
Backend:
  1. Detects NEW_REEL intent
  2. Extracts idea from message
  3. Queues job
  4. Sends "✨ Analyzing your reel..."
  5. Worker processes → Generates script
  6. Worker sends script image + copy link
  7. Updates state to AWAITING_FEEDBACK
      ↓
User receives: Script image + copy link
```

### Flow 2: Reel First, Idea Second (Two-Message Flow)

```
User: https://instagram.com/reel/ABC123
      ↓
Backend:
  1. Detects NEW_REEL intent
  2. No idea → Stores reel URL
  3. Updates state to AWAITING_IDEA
  4. Sends "🎬 Got it! What's your idea?"
      ↓
User: make it motivational for entrepreneurs
      ↓
Backend:
  1. Detects SUBMIT_IDEA intent
  2. Retrieves stored reel URL
  3. Combines reel + idea → Queues job
  4. Worker processes → Sends script
  5. Updates state to AWAITING_FEEDBACK
      ↓
User receives: Script image + copy link
```

### Flow 3: Variation Request

```
User: another
      ↓
Backend:
  1. Detects VARIATION intent
  2. Gets last reel + idea from state
  3. Queues variation job
  4. Sends "🔄 Creating version #2..."
  5. Worker processes → Sends new script
  6. Updates state metadata with new script
      ↓
User receives: New script image + copy link
```

### Flow 4: Copy Request

```
User: copy
      ↓
Backend:
  1. Detects COPY intent
  2. Gets last script URL from state (the AI-generated script)
  3. Sends "📋 Tap to copy: https://..."
      ↓
User receives: Copy link to their generated script
```

### Flow 5: Extract Original Transcript

```
User: extract
      ↓
Backend:
  1. Detects EXTRACT_ORIGINAL intent
  2. Gets last reel URL from state
  3. Queues job with isCopyMode=true
  4. Sends "🎤 Extracting original transcript..."
  5. Worker downloads video → Extracts speech → Formats as script
  6. Sends formatted transcript as script image
      ↓
User receives: The EXACT words from the video formatted as a script
```

**Keywords that trigger Extract:**
- "extract", "original", "transcript", "source"
- "what did they say", "exact words", "their script"

### Flow 6: Error Recovery

```
User: https://instagram.com/reel/INVALID
      ↓
Backend:
  1. Queues job
  2. Worker fails to download (retries 3x)
  3. On final failure:
     - Sends "❌ Couldn't download that reel. Try another link!"
     - Updates state to ERROR
      ↓
User can: Send a new reel (state allows it)
```

---

## 📦 What Gets Stored

The backend stores data in the user's state for later use:

| When | What Gets Stored |
|------|------------------|
| User sends reel only | `reelUrl` |
| Job queued | `reelUrl`, `userIdea`, `lastJobId` |
| Job completes | `lastScriptUrl`, `lastScriptId`, `lastImageUrl`, `lastReelUrl`, `lastUserIdea` |
| Job fails | `lastError`, `lastErrorType` |

This enables:
- ✅ Two-message flow (reel then idea)
- ✅ COPY intent (finds `lastScriptUrl`)
- ✅ VARIATION intent (finds `lastReelUrl` + `lastUserIdea`)
- ✅ EXTRACT_ORIGINAL intent (finds `lastReelUrl` for transcript extraction)
- ✅ Error recovery (state is ERROR, user can start fresh)

---

## 🚨 Keywords Handled by Backend

| Intent | Keywords/Patterns |
|--------|------------------|
| **NEW_REEL** | `instagram.com/reel`, `instagram.com/p/` |
| **VARIATION** | redo, again, another, different, retry, more, next, 🔄 |
| **COPY** | copy, link, share, text, 📋 |
| **EXTRACT_ORIGINAL** | extract, original, transcript, source, exact words, their script, 🎤 |
| **HELP** | help, start, hi, hello, hey, hola, sup |
| **SUBMIT_IDEA** | Any text (when in AWAITING_IDEA state) |

---

## ⚙️ External Request Settings

| Setting | Value |
|---------|-------|
| Request Type | POST |
| URL | `https://your-domain.com/api/v3/webhook` |
| Header | Content-Type: application/json |
| Timeout | 30 seconds |
| Response Action | None (backend sends responses directly) |

---

## ✅ Testing Checklist

| Test | What User Sends | Expected Result |
|------|-----------------|-----------------|
| Reel only | `https://instagram.com/reel/ABC` | "What's your idea?" prompt |
| Idea after reel | `make it funny` | Script generated and delivered |
| Reel + idea | `https://...ABC make it funny` | Script generated and delivered |
| Variation | `another` (after script) | New script delivered |
| Copy | `copy` (after script) | Copy link to AI-generated script |
| Extract Original | `extract` or `original` (after script) | Original transcript from video |
| Help | `hi` or `help` | Welcome message |
| Invalid reel | Invalid URL | Error message, state reset to ERROR |
| New reel after error | New reel URL | Works! Can start fresh |

---

## 📝 Environment Variables

```env
# ManyChat Configuration
MANYCHAT_API_KEY=your_api_token_here
MANYCHAT_SCRIPT_FIELD_ID=12345
MANYCHAT_COPY_FIELD_ID=12346
MANYCHAT_ENABLE_DIRECT_MESSAGING=true

# Rate Limiting
USER_RATE_LIMIT=10

# Backend
BASE_URL=https://your-domain.com
```

---

## 💡 Tips

1. **Use Default Reply only** - No need for keyword triggers
2. **Use `{{psid}}`** - This is the subscriber ID, required!
3. **Use `{{last_input_text}}`** - This is the user's message
4. **Set trigger to "Every time"** - Don't use "Once every 24 hours"
5. **Don't worry about errors** - Backend handles them and resets state
6. **Test with ngrok** first: `ngrok http 3000`

---

## 🔗 Quick Links

- **ManyChat Dashboard**: https://manychat.com/apps/
- **Default Reply Settings**: Settings → Instagram → Default Reply
- **Your Webhook URL**: `https://your-domain.com/api/v3/webhook`

---

## Summary

| What | Who Handles |
|------|-------------|
| Message forwarding | ManyChat (Default Reply) |
| Intent detection | Backend |
| Keyword matching | Backend |
| State management | Backend |
| Script generation | Backend (Worker) |
| Script delivery | Backend (Worker → ManyChat API) |
| Error recovery | Backend |
| Response messages | Backend (via ManyChat API) |

**ManyChat's only job: Forward ALL messages to the webhook via Default Reply.**

Everything else is automatic! 🎉

---

> **Need detailed technical docs?** See MANYCHAT_INTEGRATION_GUIDE.md and CHATBOT_ARCHITECTURE.md
