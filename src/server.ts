import express, { Request, Response, NextFunction } from 'express';
import cors from 'cors';
import { generateScriptHandler } from './api/generateScript';
import { healthHandler, detailedHealthHandler } from './api/health';
import { exportDatasetHandler } from './api/dataset';
import { submitFeedbackHandler, getFeedbackStatsHandler } from './api/feedback';
import { viewScriptHandler } from './api/viewScript';
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
  betaAccessControl
} from './middleware';

export function createServer() {
  const app = express();

  // ===== SECURITY MIDDLEWARE (Order matters!) =====
  
  // 1. Security headers (Helmet)
  app.use(helmetMiddleware);
  
  // 2. Request fingerprinting (before logging)
  app.use(requestFingerprint);
  
  // 3. Security logging
  app.use(securityLogger);
  
  // 4. CORS - Configure properly
  app.use(cors({
    origin: config.NODE_ENV === 'production' 
      ? ['https://manychat.com', /\.manychat\.com$/] 
      : '*',
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type', 'Authorization', 'x-api-key'],
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

  // ===== TIMEOUT MIDDLEWARE =====
  app.use((req: Request, res: Response, next: NextFunction) => {
    const timeout = setTimeout(() => {
      if (!res.headersSent) {
        logger.warn(`Request timed out: ${req.method} ${req.path}`);
        res.status(503).json({
          status: 'error',
          code: 'TIMEOUT',
          message: 'Request processing exceeded time limit'
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

  // Feedback submission (public - tied to subscriber_id)
  app.post('/api/v1/feedback', submitFeedbackHandler);

  // ===== PROTECTED ROUTES (Admin) =====
  
  // Dataset export (requires API key)
  app.get('/api/v1/dataset/export', apiKeyAuth, exportDatasetHandler);
  
  // Feedback stats (requires API key)
  app.get('/api/v1/feedback/stats', apiKeyAuth, getFeedbackStatsHandler);

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
