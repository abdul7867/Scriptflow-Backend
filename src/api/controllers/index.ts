/**
 * API Controllers Index
 * Centralized exports for all controller functions
 */

// Script generation controllers (V2 - recommended)
export { generateScriptHandlerV2 } from './generateScriptV2.controller';
// Legacy handler for backwards compatibility
export { generateScriptHandler } from './generateScript.legacy.controller';

// Health and monitoring
export * from './health.controller';
export * from './viewScript.controller';

// Data management
export * from './dataset.controller';
export * from './feedback.controller';
export * from './feedbackV2.controller';

// Webhooks
export * from './webhook.controller';
