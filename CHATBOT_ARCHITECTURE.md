# ScriptFlow Chatbot Architecture v3.0

> **Date**: January 7, 2026  
> **Author**: ScriptFlow Development Team  
> **Status**: Implemented & Ready for Testing

---

## 📋 Table of Contents

1. [Overview](#overview)
2. [Architecture](#architecture)
3. [Components](#components)
4. [Request Flow](#request-flow)
5. [State Diagram](#state-diagram)
6. [API Reference](#api-reference)
7. [Loop Prevention](#loop-prevention)
8. [Error Handling](#error-handling)
9. [Configuration](#configuration)
10. [Files Created](#files-created)

---

## Overview

ScriptFlow v3.0 introduces a completely refactored chatbot architecture with:

- **Deterministic Finite State Machine (FSM)** - Enum-based states with explicit transition validation
- **Rule-Based Intent Classifier** - No AI/ML, pure pattern matching
- **Clean Architecture** - No business logic in controllers
- **Loop Prevention** - Automatic detection and blocking of automation loops
- **State Persistence** - Redis-based per-subscriber state management

### Key Design Principles

| Principle | Implementation |
|-----------|----------------|
| **Separation of Concerns** | Controllers handle HTTP only; services handle business logic |
| **Deterministic Behavior** | No probabilistic/AI components; predictable pattern matching |
| **Explicit Error Handling** | Custom error classes with detailed context |
| **State Immutability** | FSM states are enum-based; transitions are validated |
| **Loop Safety** | Multi-layered loop detection prevents automation recursion |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              HTTP REQUEST                                    │
│                         (from ManyChat Webhook)                             │
└─────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                        webhookController.ts                                  │
│   • Parse & validate request (Zod schema)                                   │
│   • Call webhookService.processWebhook()                                    │
│   • Map result to HTTP response                                             │
│   • Record metrics                                                          │
│   ⚠️ NO BUSINESS LOGIC - ONLY HTTP CONCERNS                                │
└─────────────────────────────────────────────────────────────────────────────┘
                                     │
                                     ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                         webhookService.ts                                    │
│   STEP 0: Loop Prevention ─────────► loopPrevention.checkForLoop()          │
│   STEP 1: Check Blocked ───────────► isUserBlocked()                        │
│   STEP 2: Check Rate Limits ───────► getUserRateLimitStatus()               │
│   STEP 3: Load State ──────────────► chatbotFSM.getCurrentState()           │
│   STEP 4: Detect Intent ───────────► intentClassifier.classify()            │
│   STEP 5: Validate Transition ─────► chatbotFSM.transition()                │
│   STEP 6: Queue Job ───────────────► addScriptJob()                         │
│   STEP 7: Trigger Flow ────────────► manychatFlowService.triggerFlow()      │
│   STEP 8: Store Last Action ───────► loopPrevention.setLastAction()         │
└─────────────────────────────────────────────────────────────────────────────┘
           │               │               │               │
           ▼               ▼               ▼               ▼
┌──────────────┐ ┌────────────────┐ ┌────────────────┐ ┌──────────────────┐
│ chatbotFSM   │ │ intentClassifier│ │ manychatFlow   │ │ loopPrevention   │
│              │ │                │ │ Service        │ │                  │
│ • States     │ │ • NEW_REEL     │ │ • WELCOME_HELP │ │ • System msgs    │
│ • Events     │ │ • VARIATION    │ │ • PROMPT_IDEA  │ │ • Backend flows  │
│ • Transitions│ │ • COPY         │ │ • JOB_QUEUED   │ │ • Duplicate acts │
│ • Persistence│ │ • INVALID      │ │ • RATE_LIMITED │ │ • Rate loops     │
└──────────────┘ └────────────────┘ └────────────────┘ └──────────────────┘
```

---

## Components

### 1. Finite State Machine (FSM)

**File**: `src/services/chatbotStateMachine.ts`

#### States

| State | Description |
|-------|-------------|
| `IDLE` | Initial state - no conversation started |
| `AWAITING_IDEA` | User submitted reel, waiting for idea |
| `PROCESSING` | Script generation in progress |
| `AWAITING_FEEDBACK` | Script generated, waiting for feedback |
| `REDO_REQUESTED` | User requested a variation |
| `ERROR` | An error occurred |
| `COMPLETED` | Conversation completed |

#### Events

| Event | Description |
|-------|-------------|
| `SUBMIT_REEL` | User submits a reel URL |
| `SUBMIT_IDEA` | User submits content idea |
| `START_PROCESSING` | Script generation starts |
| `PROCESSING_COMPLETE` | Script generation finished |
| `REQUEST_REDO` | User requests a variation |
| `SUBMIT_FEEDBACK` | User provides feedback |
| `CANCEL` | User cancels conversation |
| `RESET` | Start new conversation |
| `ERROR_OCCURRED` | An error happened |
| `CONFIRM` | User confirms/completes |
| `TIMEOUT` | Session timeout |

#### Key Transitions

| From State | Event | To State |
|------------|-------|----------|
| IDLE | SUBMIT_REEL | AWAITING_IDEA |
| AWAITING_IDEA | SUBMIT_IDEA | PROCESSING |
| PROCESSING | PROCESSING_COMPLETE | AWAITING_FEEDBACK |
| AWAITING_FEEDBACK | REQUEST_REDO | REDO_REQUESTED |
| AWAITING_FEEDBACK | CONFIRM | COMPLETED |
| REDO_REQUESTED | START_PROCESSING | PROCESSING |
| ERROR | RESET | IDLE |

---

### 2. Intent Classifier

**File**: `src/services/intentClassifier.ts`

#### Intents

| Intent | Description | Detection |
|--------|-------------|-----------|
| `NEW_REEL` | User submitting Instagram reel URL | URL regex patterns |
| `VARIATION` | User wants a redo/different version | Keywords: redo, again, another, 🔄 |
| `COPY` | User wants to copy the script | Keywords: copy, link, share, 📋 |
| `INVALID` | Message doesn't match patterns | Fallback |

#### Classification Priority

```
1. NEW_REEL   - Highest priority (URL detection)
2. VARIATION  - Second priority (redo keywords)
3. COPY       - Third priority (copy keywords)
4. INVALID    - Fallback (no match)
```

#### State Validity

| Intent | Valid From States |
|--------|-------------------|
| NEW_REEL | IDLE, AWAITING_IDEA, AWAITING_FEEDBACK, ERROR, COMPLETED |
| VARIATION | AWAITING_FEEDBACK, REDO_REQUESTED |
| COPY | AWAITING_FEEDBACK, COMPLETED |

---

### 3. Webhook Service

**File**: `src/services/webhookService.ts`

Main business logic orchestrator. **No business logic in controllers.**

#### WebhookResult Actions

| Action | HTTP Status | Description |
|--------|-------------|-------------|
| `queued` | 200 | Job successfully queued |
| `cached` | 200 | Script found in cache |
| `prompted` | 200 | User prompted for input |
| `ignored` | 200 | Message ignored (loop prevention) |
| `rate_limited` | 429 | User exceeded rate limit |
| `blocked` | 403 | User is blocked |
| `invalid_transition` | 400 | Invalid action for current state |
| `error` | 500 | Internal error |

---

### 4. ManyChat Flow Service

**File**: `src/services/manychatFlowService.ts`

#### Available Flows

| Flow | Description |
|------|-------------|
| `WELCOME_HELP` | Initial welcome with instructions |
| `GENERIC_HELP` | Help based on current state |
| `PROMPT_IDEA` | Ask user for content idea |
| `PROMPT_REEL` | Ask user to send a reel |
| `JOB_QUEUED` | Acknowledge job queued |
| `JOB_COMPLETED` | Script ready notification |
| `JOB_FAILED` | Error notification |
| `RATE_LIMITED` | User hit rate limit |
| `BLOCKED_USER` | User is blocked |
| `INVALID_ACTION` | Invalid action for state |
| `ERROR` | Generic error |
| `COPY_SCRIPT` | Send copy link |
| `NOTHING_TO_COPY` | No script available |
| `NO_PREVIOUS_REEL` | Can't create variation |
| `VARIATION_SOFT_LIMIT` | Too many variations |

---

### 5. Loop Prevention Service

**File**: `src/services/loopPrevention.ts`

Prevents automation loops and recursion in webhook processing.

#### Detection Methods

| Method | Description | Action |
|--------|-------------|--------|
| System Message Patterns | Regex for ManyChat system messages | Ignore |
| Backend Flow Markers | Internal markers like `__scriptflow_generated__` | Ignore |
| Ignored Sources | Sources like 'automation', 'broadcast', 'bot' | Ignore |
| Rate-Based Detection | More than 30 messages/minute | Block |
| Duplicate Detection | Same message hash within 2 seconds | Ignore |

#### System Message Patterns

```javascript
const SYSTEM_MESSAGE_PATTERNS = [
  /^<mc_/i,           // ManyChat internal tags
  /^\[SYSTEM\]/i,     // System prefix
  /^\[AUTO\]/i,       // Auto-generated prefix
  /^__FLOW__/i,       // Internal flow marker
  /^<media:/i,        // Media attachments
];
```

---

### 6. Webhook Controller

**File**: `src/api/webhookController.ts`

Thin controller layer - **contains NO business logic**.

#### Request Schema

```typescript
{
  subscriber_id: string;        // Required - ManyChat subscriber ID
  user_idea?: string;           // User's message content
  reel_url?: string;            // Instagram reel URL
  tone_hint?: string;           // Tone preference
  language_hint?: string;       // Language preference
  mode?: 'full' | 'hook_only';  // Generation mode
  source?: string;              // Message source (for loop detection)
  message_source?: string;      // ManyChat message source
}
```

---

## Request Flow

```
1. ManyChat → POST /api/v3/webhook
2. Controller validates request (Zod schema)
3. Controller calls webhookService.processWebhook()
4. WebhookService:
   a. Check for loop (loopPrevention.checkForLoop)
   b. Check if blocked (isUserBlocked)
   c. Check rate limits (getUserRateLimitStatus)
   d. Load state (chatbotFSM.getCurrentState)
   e. Classify intent (intentClassifier.classify)
   f. Validate transition (chatbotFSM.transition)
   g. Queue job (addScriptJob)
   h. Trigger flow (manychatFlowService.triggerFlow)
   i. Store last action (loopPrevention.setLastAction)
5. Controller maps result to HTTP response
6. Controller records metrics
```

---

## State Diagram

```
                         SUBMIT_REEL
              ┌──────────┐ ──────────► ┌─────────────────┐
     ┌───────►│   IDLE   │             │  AWAITING_IDEA  │
     │        └──────────┘             └────────┬────────┘
     │             ▲                            │
     │             │                    SUBMIT_IDEA
     │           RESET                          │
     │             │                            ▼
     │        ┌──────────┐◄─────────── ┌────────────────┐
     └────────┤  ERROR   │  ERROR      │   PROCESSING   │
              └──────────┘             └────────┬───────┘
                                               │
                                      PROCESSING_COMPLETE
                                               │
                                               ▼
              ┌───────────┐            ┌───────────────────┐
              │ COMPLETED │◄───────────┤  AWAITING_FEEDBACK │
              └───────────┘  CONFIRM   └─────────┬─────────┘
                   │                             │
                   │                       REQUEST_REDO
                   │                             │
                   │                             ▼
                   │                   ┌───────────────────┐
                   └───────────────────┤  REDO_REQUESTED   │
                       START_PROCESSING└───────────────────┘
```

---

## Loop Prevention

### Why Loop Prevention?

When our backend sends messages via ManyChat, those messages can trigger webhooks back to us, creating infinite loops:

```
User sends message → Webhook → Send ManyChat message → Webhook → ...
```

### Detection Layers

1. **System Message Detection**: Regex patterns identify ManyChat system messages
2. **Backend Flow Markers**: Our messages include markers like `__scriptflow_generated__`
3. **Source Filtering**: Messages from 'automation', 'broadcast', 'bot' sources are ignored
4. **Rate Limiting**: More than 30 messages/minute triggers loop detection
5. **Duplicate Detection**: Same message within 2 seconds is deduplicated

### Last Action Storage

After each successful action, we store:
- Action type (e.g., QUEUE_SCRIPT, QUEUE_VARIATION)
- Message hash
- Timestamp
- Source (user/system/backend)
- Request ID

This prevents duplicate processing of the same action.

---

## API Reference

### POST /api/v3/webhook

**Request:**
```json
{
  "subscriber_id": "123456789",
  "user_idea": "https://instagram.com/reel/ABC123 make it funny",
  "tone_hint": "funny",
  "mode": "full"
}
```

**Response (Queued):**
```json
{
  "status": "success",
  "action": "queued",
  "message": "Creating your custom script!",
  "jobId": "abc-123-def",
  "state": "PROCESSING",
  "rateLimit": {
    "remaining": 8,
    "limit": 10,
    "resetInSeconds": 3245
  }
}
```

**Response (Ignored):**
```json
{
  "status": "ignored",
  "action": "ignored",
  "message": "Message appears to be system-generated",
  "code": "LOOP_SYSTEM_MESSAGE"
}
```

### GET /api/v3/job/:jobId

**Response:**
```json
{
  "status": "success",
  "job": {
    "id": "abc-123-def",
    "status": "completed",
    "attempts": 1,
    "processingTimeMs": 15000
  }
}
```

---

## Error Handling

### FSM Errors

| Error Class | Code | Description |
|-------------|------|-------------|
| `FSMTransitionError` | `INVALID_TRANSITION` | Attempted invalid state transition |
| `FSMPersistenceError` | `REDIS_ERROR` | Failed to read/write state to Redis |

### Error Response

```json
{
  "error": {
    "code": "INVALID_TRANSITION",
    "message": "Cannot trigger 'REQUEST_REDO' from state 'IDLE'",
    "currentState": "IDLE",
    "attemptedEvent": "REQUEST_REDO",
    "validEvents": ["SUBMIT_REEL", "RESET"]
  }
}
```

---

## Configuration

### Redis Keys

| Key Pattern | TTL | Purpose |
|-------------|-----|---------|
| `fsm:state:{subscriberId}` | 1 hour | FSM state context |
| `loop:last_action:{subscriberId}` | 5 min | Last action record |
| `loop:rate:{subscriberId}` | 1 min | Message rate counter |
| `user_rl:{subscriberId}` | 1 hour | Rate limit counter |
| `blocked:{subscriberId}` | Variable | User block flag |

---

## Files Created

| File | Description |
|------|-------------|
| `src/services/chatbotStateMachine.ts` | Deterministic FSM with enum states |
| `src/services/intentClassifier.ts` | Rule-based intent classification |
| `src/services/webhookService.ts` | Main business logic orchestrator |
| `src/services/manychatFlowService.ts` | ManyChat API wrapper with flows |
| `src/services/loopPrevention.ts` | Automation loop prevention |
| `src/api/webhookController.ts` | Thin HTTP controller |

---

## Next Steps

1. **Register Routes** - Add webhook routes to `server.ts`:
   ```typescript
   import { webhookHandler, jobStatusHandler } from './api/webhookController';
   app.post('/api/v3/webhook', webhookHandler);
   app.get('/api/v3/job/:jobId', jobStatusHandler);
   ```

2. **Update Worker** - Integrate FSM state updates on job completion

3. **Add Monitoring** - Prometheus metrics for FSM transitions

4. **Test** - Run integration tests with ManyChat

---

> **ScriptFlow v3.0** - Clean architecture, deterministic behavior, loop-safe automation
