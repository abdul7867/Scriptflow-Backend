# 🧪 Postman Testing Guide for ScriptFlow API

## 📦 Quick Setup

### 1. Import Collection
1. Open Postman
2. Click **Import** button
3. Select `ScriptFlow_API_Collection.json`
4. Collection will appear in your workspace

### 2. Configure Environment Variables

#### Option A: Use Collection Variables (Quick)
The collection comes with default variables:
- `base_url`: `http://localhost:3000` (change to your server URL)
- `admin_api_key`: Your admin API key for protected endpoints

**To edit:**
1. Right-click collection → **Edit**
2. Go to **Variables** tab
3. Update values

#### Option B: Create Environment (Recommended)
1. Click **Environments** in sidebar
2. Click **+** to create new environment
3. Name it "ScriptFlow Local" or "ScriptFlow Production"
4. Add variables:

| Variable | Initial Value | Current Value |
|----------|--------------|---------------|
| `base_url` | `http://localhost:3000` | `http://localhost:3000` |
| `admin_api_key` | `your-api-key` | `your-api-key` |
| `job_id` | *(leave empty)* | *(auto-populated)* |
| `public_id` | *(leave empty)* | *(auto-populated)* |
| `request_hash` | *(leave empty)* | *(auto-populated)* |

5. **Select** the environment from dropdown (top-right)

---

## 🚀 Test Scenarios

### Scenario 1: Basic Health Check
**Goal:** Verify server is running

1. **Health Check** → Send
   - Expected: `200 OK`
   - Response: `{ "status": "healthy" }`

2. **Detailed Health Check** → Send
   - Expected: `200 OK`
   - Should show MongoDB, Redis, Queue status

---

### Scenario 2: Generate New Script (V2)
**Goal:** Complete script generation flow

1. **Script Generation - V2** → **Generate Script V2 (Unified)** → Send
   - Update `subscriber_id` to your ManyChat user ID
   - Update `reel_url` to actual Instagram Reel
   - Update `user_idea` with your content idea
   - Expected: `202 Accepted` (job queued)
   - Job ID will be auto-saved to `{{job_id}}`

2. **Check Job Status** → Send (wait 3-5 seconds first)
   - Uses auto-saved `{{job_id}}`
   - Expected: `200 OK`
   - Status: `queued` → `processing` → `completed`
   - **Poll every 3-5 seconds until status is `completed`**

3. Once completed, check the result:
   - `public_id` will be auto-saved
   - You'll see full script in response

4. **Public Script Viewing** → **View Script** → Send
   - Opens the public copy page
   - Uses auto-saved `{{public_id}}`

---

### Scenario 3: Test Duplicate Detection (Cache)
**Goal:** Verify V2 returns cached results instantly

1. Run **Scenario 2** first to generate initial script

2. **Script Generation - V2** → **Generate Script V2 (Unified)** → Send
   - Use **exact same** `subscriber_id`, `reel_url`, and `user_idea`
   - Expected: `200 OK` (instant response!)
   - Should return cached result without queuing
   - Flow detection: `cached_result`

---

### Scenario 4: Generate Variation
**Goal:** Test anti-repetition system

1. Run **Scenario 2** first

2. **Script Generation - V2** → **Generate Variation (Same Idea)** → Send
   - Keep same `subscriber_id` and `reel_url`
   - Keep same or similar `user_idea`
   - Change `tone_hint` to get different style
   - Expected: `202 Accepted` (new job)
   - AI will avoid repeating previous hooks
   - Flow detection: `variation_request`

3. Poll status as usual

4. Compare with original script:
   - Hook should be completely different
   - Same video DNA but fresh angle

---

### Scenario 5: Submit Feedback
**Goal:** Test feedback submission

1. After completing **Scenario 2**, get the `request_hash` from job result

2. **Feedback - V2** → **Quick Feedback** → Send
   - Update `subscriber_id`
   - Update `request_hash` (auto-saved from test scripts)
   - Set `sentiment`: `"positive"` | `"negative"` | `"neutral"`
   - Expected: `200 OK`

3. **Feedback - V2** → **Submit Enhanced Feedback V2** → Send
   - For detailed feedback with ratings
   - Expected: `200 OK`

---

### Scenario 6: Admin Endpoints (Requires API Key)
**Goal:** Test admin functionality

1. Set `admin_api_key` in environment variables

2. **Admin Endpoints** → **Prometheus Metrics** → Send
   - Expected: `200 OK`
   - Returns Prometheus format metrics

3. **Feedback - V2** → **Get Enhanced Feedback Stats** → Send
   - Expected: `200 OK`
   - Returns aggregated feedback statistics

4. **Admin Endpoints** → **Export Dataset** → Send
   - Expected: `200 OK`
   - Returns complete dataset

---

## 🧪 Automated Test Flow

### Run Complete Flow
Use the **Test Flows** → **Complete Flow: Generate + Poll + Feedback** folder:

1. Select the folder
2. Click **Run** button (Runner icon)
3. Runs all 3 requests in sequence:
   - Generate Script
   - Check Job Status
   - Submit Feedback
4. Auto-saves variables between requests
5. Includes test assertions

**Note:** You may need to run "Check Job Status" multiple times manually until job completes.

---

## 📝 Important Notes

### Rate Limits
- **Beta Access:** First 100 users only (others go to waitlist)
- **User Rate Limit:** 10 requests/hour per `subscriber_id`
- **IP Rate Limit:** 100 requests/15 minutes
- Exceeded limits return `429 Too Many Requests`

### Webhook vs Direct API
- These endpoints are designed for **ManyChat webhook integration**
- For direct testing, use valid Instagram Reel URLs
- ManyChat will auto-populate `{{...}}` variables in production

### Job Status Polling
- Don't poll faster than every 2 seconds
- Jobs typically complete in 30-60 seconds
- Timeout after 2 minutes

### Error Codes
- `400`: Invalid request body (check validation)
- `403`: Not in beta users / blocked
- `429`: Rate limit exceeded
- `500`: Server error (check logs)
- `503`: Timeout (retry with exponential backoff)

---

## 🔧 Troubleshooting

### "Cannot connect to server"
- Verify `base_url` is correct
- Check if server is running: `npm run dev`
- Try health check endpoint first

### "Rate limit exceeded"
- Wait 1 hour for user rate limit reset
- Or use different `subscriber_id` for testing

### "Job not found"
- `job_id` might be incorrect
- Check environment variables
- Job might have expired (>24 hours old)

### "Invalid Instagram URL"
- Must be HTTPS
- Must be from instagram.com domain
- Must be `/reel/` or `/reels/` path
- Example: `https://www.instagram.com/reel/C1234567890/`

### "Admin endpoint returns 401"
- Set correct `admin_api_key` in environment
- Check `ADMIN_API_KEY` in server `.env` file
- Header: `x-api-key: your-key-here`

---

## 🎯 Collection Features

### Auto-Save Variables
Test scripts automatically save:
- `job_id` → From script generation response
- `public_id` → From completed job result
- `request_hash` → For feedback submission

### Response Time Logging
Every request logs response time to console:
```
Response time: 1234ms
```

### Test Assertions
Some requests include automated tests:
- Status code validation
- Response structure checks
- Success message verification

### Dynamic Data
Uses Postman variables for realistic testing:
- `{{$randomInt}}` → Random subscriber ID
- `{{$randomJobTitle}}` → Random idea seed

---

## 📚 Additional Resources

- **API Documentation:** See `CHATBOT_ARCHITECTURE.md`
- **Docker Setup:** See `DOCKER_AUDIT.md`
- **Security Audit:** See `SECURITY_AUDIT.md`
- **ManyChat Integration:** See `MANYCHAT_INTEGRATION_GUIDE.md`

---

## 🤝 Contributing

Found an issue or want to add more test scenarios?
1. Add new request to collection
2. Update this README
3. Submit PR

---

**Happy Testing! 🚀**
