/**
 * Generate Script API - Main Entry Point
 * 
 * ScriptFlow 2.0
 * 
 * This file exports both the new unified handler (v2) and legacy handler.
 * Use generateScriptHandlerV2 for new integrations.
 */

// V2 Unified Handler (recommended)
export { 
  generateScriptHandlerV2,
  getJobStatusHandler 
} from './generateScriptV2';

// Legacy Handler (for backwards compatibility)
export { generateScriptHandler } from './generateScript.legacy';
