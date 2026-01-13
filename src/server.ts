/// <reference path="./types.d.ts" />
import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { generateScriptHandler, generateScriptHandlerV2, getJobStatusHandler } from './api/routes/script.routes';
import { healthHandler, detailedHealthHandler } from './api/controllers/health.controller';
import { exportDatasetHandler } from './api/controllers/dataset.controller';
import { submitFeedbackHandler, getFeedbackStatsHandler } from './api/controllers/feedback.controller';
import { submitFeedbackHandlerV2, getFeedbackStatsHandlerV2, quickFeedbackHandler } from './api/controllers/feedbackV2.controller';
import { viewScriptHandler } from './api/controllers/viewScript.controller';
import { webhookHandler, jobStatusHandler as webhookJobStatusHandler } from './api/controllers/webhook.controller';
import metricsRouter from './api/routes/metrics.routes';
import { logger } from './utils/logger';
import { config } from './config';
import {
  helmetMiddleware,
  rateLimiter,
  hppMiddleware,
  mongoSanitizeMiddleware,
  requestFingerprint,
  securityLogger,
  apiKeyAuth,
  userRateLimiter,
  checkUserBlocked,
  betaAccessControl,
  healthGate
} from './middleware';

export function createServer() {
  const app = express();

  // ===== PROXY CONFIGURATION =====
  // Trust proxy to correctly handle X-Forwarded-* headers from Nginx/AWS/reverse proxy
  // This fixes ERR_ERL_UNEXPECTED_X_FORWARDED_FOR from express-rate-limit
  // Use 1 instead of true to resolve ERR_ERL_PERMISSIVE_TRUST_PROXY
  // 1 = trust first proxy hop (appropriate when behind single proxy like AWS ALB, Nginx)
  app.set('trust proxy', 1);

  // ===== REQUEST LOGGING (First middleware - logs ALL incoming requests) =====
  app.use((req: Request, res: Response, next: NextFunction) => {
    // Log every incoming request for debugging
    // This runs BEFORE any other middleware, so we can see if requests are reaching the server
    logger.info(`[Incoming] ${req.method} ${req.path}`, {
      ip: req.ip,
      userAgent: req.headers['user-agent']?.substring(0, 50),
      contentLength: req.headers['content-length'],
    });
    next();
  });

  // ===== SECURITY MIDDLEWARE (Order matters!) =====

  // 1. Security headers (Helmet)
  app.use(helmetMiddleware);

  // 2. Request fingerprinting (before logging)
  app.use(requestFingerprint);

  // 3. Security logging
  app.use(securityLogger);

  // 4. CORS - Configure properly
  // Allow ManyChat, our own domain, and subdomains in production
  app.use(cors({
    origin: config.NODE_ENV === 'production'
      ? [
        'https://manychat.com',
        /\.manychat\.com$/,
        'https://scriptflow.app',
        /\.scriptflow\.app$/
      ]
      : '*',
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key', 'x-request-id'],
    credentials: true
  }));

  // 5. Body parsing with size limit
  app.use(express.json({ limit: '10kb' }));
  app.use(express.urlencoded({ extended: true, limit: '10kb' }));

  // 6. MongoDB query sanitization (Must run BEFORE hpp to avoid req.query conflict)
  app.use(mongoSanitizeMiddleware);

  // 7. HTTP Parameter Pollution protection
  app.use(hppMiddleware);

  // 8. Rate limiting (after body parse, before routes)
  app.use(rateLimiter);

  // 9. Health Gate - System overload protection (Layer 2 of Defense-in-Depth)
  // Rejects requests early when system is stressed (memory > 85%, queue > 150 jobs)
  app.use(healthGate);

  // ===== TIMEOUT MIDDLEWARE =====
  app.use((req: Request, res: Response, next: NextFunction) => {
    // Add request ID for distributed tracing
    const requestId = req.headers['x-request-id'] as string ||
      req.headers['x-amzn-trace-id'] as string ||
      `req_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    req.requestId = requestId;
    res.setHeader('X-Request-ID', requestId);

    const timeout = setTimeout(() => {
      if (!res.headersSent) {
        logger.warn(`Request timed out: ${req.method} ${req.path}`, { requestId });
        res.setHeader('Retry-After', '60'); // Suggest retry after 60 seconds
        res.status(503).json({
          status: 'error',
          code: 'TIMEOUT',
          message: 'Request processing exceeded time limit',
          requestId
        });
      }
    }, 30000); // 30 seconds for queued operations

    res.on('finish', () => clearTimeout(timeout));
    next();
  });

  // ===== PUBLIC ROUTES =====

  // Health checks (no rate limit)
  app.get('/health', healthHandler);
  app.get('/health/detailed', detailedHealthHandler);

  // Public script viewing page (copy-friendly)
  // Short URL: /s/:publicId
  // Rate limited: 60 requests per minute per IP (generous for normal use)
  app.get('/s/:publicId', viewScriptHandler);

  // Main API endpoint with ACCESS CONTROL
  // 1. betaAccessControl - Only first 100 users, others on waitlist
  // 2. checkUserBlocked - Check if user is blocked
  // 3. userRateLimiter - 10 requests per hour per subscriber_id
  // 4. generateScriptHandler - Process the request
  app.post('/api/v1/script/generate',
    betaAccessControl,   // First 100 users only
    checkUserBlocked,
    userRateLimiter,
    generateScriptHandler
  );

  // V2 Unified Handler (with smart flow detection)
  app.post('/api/v2/script/generate',
    betaAccessControl,
    checkUserBlocked,
    userRateLimiter,
    generateScriptHandlerV2
  );

  // V2 Alias (for ManyChat compatibility)
  app.post('/api/v2/generate-script',
    betaAccessControl,
    checkUserBlocked,
    userRateLimiter,
    generateScriptHandlerV2
  );

  // V3 Webhook Handler (FSM-based with Intent Classification)
  // Rate limiting is now done inside webhook service to only count successful job queues
  app.post('/api/v3/webhook',
    betaAccessControl,
    checkUserBlocked,
    // userRateLimiter removed - now handled in webhook service
    webhookHandler
  );

  // Job status endpoints
  app.get('/api/v1/job/:jobId', getJobStatusHandler);
  app.get('/api/v3/job/:jobId', webhookJobStatusHandler);

  // Feedback submission (public - tied to subscriber_id)
  app.post('/api/v1/feedback', submitFeedbackHandler);

  // V2 Enhanced Feedback
  app.post('/api/v2/feedback', submitFeedbackHandlerV2);
  app.post('/api/v2/feedback/quick', quickFeedbackHandler);

  // ===== PROTECTED ROUTES (Admin) =====

  // Prometheus metrics endpoint
  app.use('/metrics', metricsRouter);

  // Dataset export (requires API key)
  app.get('/api/v1/dataset/export', apiKeyAuth, exportDatasetHandler);

  // Feedback stats (requires API key)
  app.get('/api/v1/feedback/stats', apiKeyAuth, getFeedbackStatsHandler);
  app.get('/api/v2/feedback/stats', apiKeyAuth, getFeedbackStatsHandlerV2);

  // ===== ERROR HANDLING =====

  // 404 Handler
  app.use((req: Request, res: Response, next: NextFunction) => {
    res.status(404).json({
      status: 'error',
      code: 'NOT_FOUND',
      message: `Endpoint not found: ${req.method} ${req.originalUrl}`
    });
  });

  // Central Error Handler
  app.use((err: any, req: Request, res: Response, next: NextFunction) => {
    logger.error('Unhandled server error', err);

    if (!res.headersSent) {
      res.status(err.status || 500).json({
        status: 'error',
        code: err.code || 'INTERNAL_ERROR',
        message: config.NODE_ENV === 'production'
          ? 'An unexpected error occurred'
          : err.message
      });
    }
  });

  return app;
}
