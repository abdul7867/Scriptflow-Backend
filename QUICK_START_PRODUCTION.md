# Quick Start - Production Mode 🚀

## ⚡ TL;DR - Start Production Server

```bash
# 1. Build (one time)
npm run build

# 2. Start production server
npm start

# 3. Monitor logs
# Memory should show ~37MB at startup (not 423MB)
```

---

## 🎯 Expected Output

```
✅ Server listening on port 3000
✅ Memory Governor started
✅ Queue concurrency: 2
✅ Memory: 37MB/512MB (7%)  ← Should be ~7%, NOT 99%!
✅ BullMQ Worker ready (concurrency: 2)
```

---

## ⚠️ Critical: Don't Use Dev Mode!

| Command | Memory | Use Case |
|---------|--------|----------|
| ❌ `npm run dev` | 423MB (99%) | **DON'T USE** - Only for debugging |
| ✅ `npm start` | 37MB (7%) | **PRODUCTION** - Use this! |
| ✅ `npm run dev:optimized` | 250MB (25%) | **TESTING** - For testing with rebuild |

---

## 📊 Quick Health Check

### ✅ Healthy System
```
Memory: 37MB - 150MB (7% - 30%)
Redis: Connected
Queue: Active (concurrency: 2)
FSM: No retry warnings
```

### ⚠️ Warning Signs
```
Memory: 200MB - 300MB (40% - 60%)
Redis: Reconnecting frequently
Queue: Paused due to memory
FSM: Occasional retry warnings
```

### 🚨 Critical Issues
```
Memory: 400MB+ (80%+)
Redis: Connection refused
Queue: Stopped
FSM: Persistent failures
```

**Solution:** Restart with `npm run build && npm start`

---

## 🔥 Emergency Commands

### Clear Stuck Jobs
```bash
npx ts-node scripts/clear-stuck-states.ts
```

### Check Rate Limits
```bash
npx ts-node scripts/check-rate-limit.ts
```

### Full System Diagnostic
```bash
npx ts-node scripts/verify-setup.ts
```

---

## 📈 Capacity Guide

### Current Setup (t3.micro: 1GB RAM)
- **Concurrent jobs:** 15-20
- **Concurrent users:** 50-100
- **Queue backpressure:** Active at 150 jobs
- **Memory buffer:** 35% reserved

### When to Scale Up
| Sign | Current | Needed | Action |
|------|---------|--------|--------|
| Memory > 80% | t3.micro (1GB) | t3.small (2GB) | Upgrade instance |
| Queue depth > 150 | Concurrency 2 | Concurrency 5 | Increase QUEUE_CONCURRENCY |
| Rate limit hits | 10/user/15min | 20/user/15min | Increase USER_RATE_LIMIT |

---

## 🛠️ Production Checklist

Before deploying:
- [ ] Run `npm run build` (no errors)
- [ ] Test with `npm run dev:optimized` (memory < 300MB)
- [ ] Check `.env` has `QUEUE_CONCURRENCY=2`
- [ ] Verify Instagram cookies exist: `secrets/instagram_cookies.txt`
- [ ] Verify GCP credentials: `secrets/abdul-content-creation-82cb87bf38df.json`
- [ ] Test endpoint: `curl http://localhost:3000/api/health`

---

## 📝 Configuration Quick Reference

### .env
```bash
PORT=3000
NODE_ENV=production
QUEUE_CONCURRENCY=2          # Don't increase without testing
USER_RATE_LIMIT=10           # Per user per 15 minutes
```

### package.json Scripts
```json
"start": "node --max-old-space-size=512 --expose-gc dist/index.js"  # t3.micro
"start:prod": "node --max-old-space-size=900 --expose-gc dist/index.js"  # t3.small+
```

---

## 🎯 Success Indicators

### After starting `npm start`, you should see:

1. **Startup Memory (Critical)**
   ```
   Memory: 37MB/512MB (7%)  ← Must be low!
   ```
   If you see 423MB/427MB (99%) → You're in dev mode, STOP and rebuild!

2. **Services Connected**
   ```
   ✅ MongoDB connected successfully
   ✅ Redis connected and ready
   ✅ Vertex AI initialized
   ✅ Instagram cookies found
   ```

3. **Queue Active**
   ```
   ✅ BullMQ queue initialized
   ✅ BullMQ Worker ready (concurrency: 2)
   ```

4. **Monitoring Active**
   ```
   ✅ Memory Governor started
   ✅ Queue monitoring started
   ```

---

## 🚨 Common Mistakes

### ❌ Mistake #1: Using Dev Mode
```bash
npm run dev  # ← DON'T! Uses 423MB
```
**Fix:** Use `npm start` (uses 37MB)

### ❌ Mistake #2: Not Building First
```bash
npm start  # ← Will fail if dist/ doesn't exist
```
**Fix:** Run `npm run build` first

### ❌ Mistake #3: Forgetting Environment
```bash
node dist/index.js  # ← Missing memory flags
```
**Fix:** Use `npm start` (includes --max-old-space-size=512)

---

## 📞 Need Help?

1. **Check logs:** Look for ERROR, WARN, or CRITICAL
2. **Check memory:** Should be under 50% (< 256MB)
3. **Run diagnostic:** `npx ts-node scripts/verify-setup.ts`
4. **Review docs:** [SYSTEM_OPTIMIZATION_COMPLETE.md](SYSTEM_OPTIMIZATION_COMPLETE.md)

---

**Remember: Always use `npm start` for production! 🚀**
