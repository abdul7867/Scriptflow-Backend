// Middleware exports
export {
  helmetMiddleware,
  rateLimiter,
  initRateLimiter,
  strictRateLimiter,
  hppMiddleware,
  mongoSanitizeMiddleware,
  apiKeyAuth,
  requestFingerprint,
  bodySizeLimit,
  securityLogger
} from './security';

export {
  userRateLimiter,
  vipRateLimiter,
  checkUserBlocked,
  createUserRateLimiter,
  getUserRateLimitStatus,
  blockUser,
  unblockUser,
  isUserBlocked
} from './userRateLimiter';

export {
  betaAccessControl,
  getBetaStats,
  grantAccess,
  removeUser,
  getWaitlist,
  promoteNextFromWaitlist
} from './betaAccess';

// Health Gate - System overload protection (Layer 2 of Defense-in-Depth)
export { healthGate, getSystemHealth } from './healthGate';
export type { SystemHealth, DegradationLevel, HealthGateConfig } from './healthGate';
