/**
 * ManyChat State Service
 * 
 * Manages ManyChat custom field state updates to implement a "pull-based" delivery model.
 * This avoids triggerFlow and message_tag which cause Meta 400 errors and 24-hour blocks.
 * 
 * Custom Fields Used:
 * - sc_status: "Processing" | "Ready" | "Error" - Current job status
 * - sc_last_script: The generated script text content
 * - sc_last_image: The ImgBB URL to the script image
 * 
 * The user "pulls" data by typing "Hi" which triggers a ManyChat automation
 * that reads these custom fields and displays the script.
 * 
 * @author ScriptFlow Team
 * @version 1.0.0
 */

import axios from 'axios';
import { logger } from '../../utils/logger';
import { config } from '../../config';

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

const API_TIMEOUT_MS = 30000;

/**
 * Status values for sc_status custom field
 */
export enum ScriptStatus {
    PROCESSING = 'Processing',
    READY = 'Ready',
    ERROR = 'Error',
    BUSY = 'Busy',  // Rate limited - user should try again later
}

/**
 * Custom field configuration interface
 */
export interface ManyChatFieldConfig {
    /** Field ID for sc_status */
    statusFieldId: string;
    /** Field ID for sc_last_script (text content) */
    scriptFieldId: string;
    /** Field ID for sc_last_image (ImgBB URL) */
    imageFieldId: string;
}

// Field IDs from configuration
const FIELD_IDS = {
    SC_STATUS: config.MANYCHAT_SC_STATUS_FIELD_ID || '',
    SC_LAST_SCRIPT: config.MANYCHAT_SC_LAST_SCRIPT_FIELD_ID || '',
    SC_LAST_IMAGE: config.MANYCHAT_SC_LAST_IMAGE_FIELD_ID || '',
};

// ═══════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Get API base URL based on channel config
 */
function getApiBaseUrl(): string {
    const channel = config.MANYCHAT_CHANNEL || 'fb';
    return `https://api.manychat.com/${channel}`;
}

/**
 * Get authorization headers
 */
function getAuthHeaders(): Record<string, string> {
    return {
        'Authorization': `Bearer ${config.MANYCHAT_API_KEY}`,
        'Content-Type': 'application/json'
    };
}

/**
 * Set a single custom field value
 * 
 * @param subscriberId - The subscriber's ManyChat ID
 * @param fieldId - The custom field ID
 * @param fieldValue - The value to set
 * @returns true if successful, false otherwise
 */
async function setCustomField(
    subscriberId: string,
    fieldId: string | number,
    fieldValue: string
): Promise<boolean> {
    if (!config.MANYCHAT_API_KEY) {
        logger.warn('[ManyChatState] No API key configured, skipping field update');
        return false;
    }

    if (!fieldId) {
        logger.warn('[ManyChatState] No field ID provided, skipping field update');
        return false;
    }

    try {
        // STRICT REQUIREMENT: Use this exact endpoint
        const setFieldUrl = 'https://api.manychat.com/fb/subscriber/setCustomField';

        const subscriberIdStr = subscriberId.toString();
        // Ensure field_id is a number if possible, but keep it flexible if string is needed
        const fieldIdNum = typeof fieldId === 'string' ? parseInt(fieldId, 10) : fieldId;

        await axios.post(setFieldUrl, {
            subscriber_id: subscriberIdStr,
            field_id: fieldIdNum,
            field_value: fieldValue
        }, {
            headers: {
                'Authorization': `Bearer ${config.MANYCHAT_API_KEY}`,
                'Content-Type': 'application/json'
            },
            timeout: API_TIMEOUT_MS
        });

        logger.info(`[ManyChatState] ✅ Custom field updated: ${fieldId} for ${subscriberId}`);
        return true;
    } catch (error: any) {
        logger.error(`[ManyChatState] ❌ Failed to update field ${fieldId} for ${subscriberId}: ${error.message}`, {
            response: error.response?.data
        });
        return false;
    }
}

/**
 * Helper to set multiple fields sequentially (since we must use the single endpoint)
 */
async function setCustomFieldsSequential(
    subscriberId: string,
    fields: Array<{ field_id: string | number; field_value: string }>
): Promise<boolean> {
    // Using Promise.all to send them in parallel for speed as they are non-blocking.
    const results = await Promise.all(fields.map(f =>
        setCustomField(subscriberId, f.field_id, f.field_value)
    ));

    return results.every(r => r === true);
}

// ═══════════════════════════════════════════════════════════════════════════
// MAIN SERVICE CLASS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * ManyChatStateService - Manages pull-based state updates
 * 
 * This service implements a "poll" model where:
 * 1. Webhook sets sc_status = "Processing" and clears old data
 * 2. Worker sets sc_last_script, sc_last_image, and sc_status = "Ready"
 * 3. User types "Hi" to pull the data (ManyChat automation reads fields)
 * 
 * This avoids Meta's 24-hour messaging window restrictions.
 */
class ManyChatStateService {

    /**
     * Initialize processing state - Called when webhook is received
     * 
     * Sets sc_status to "Processing" and clears old script/image data.
     * This ensures a fresh slate for each new request.
     * 
     * @param subscriberId - The subscriber's ManyChat ID
     * @returns true if successful, false otherwise
     */
    async initializeProcessing(subscriberId: string): Promise<boolean> {
        logger.info('[ManyChatState] Initializing processing state', { subscriberId });

        // Build fields array with available field IDs
        const fields: Array<{ field_id: number; field_value: string }> = [];

        // sc_status = "Processing"
        if (FIELD_IDS.SC_STATUS) {
            fields.push({
                field_id: parseInt(FIELD_IDS.SC_STATUS, 10),
                field_value: ScriptStatus.PROCESSING
            });
        }

        // sc_last_script = "..." (clear old data with placeholder)
        if (FIELD_IDS.SC_LAST_SCRIPT) {
            fields.push({
                field_id: parseInt(FIELD_IDS.SC_LAST_SCRIPT, 10),
                field_value: 'Generating...'
            });
        }

        // sc_last_image = "-" (clear old data with placeholder)
        if (FIELD_IDS.SC_LAST_IMAGE) {
            fields.push({
                field_id: parseInt(FIELD_IDS.SC_LAST_IMAGE, 10),
                field_value: '-'
            });
        }

        if (fields.length === 0) {
            logger.warn('[ManyChatState] No field IDs configured, skipping initialization', {
                subscriberId,
                hint: 'Set MANYCHAT_SC_STATUS_FIELD_ID, MANYCHAT_SC_LAST_SCRIPT_FIELD_ID, MANYCHAT_SC_LAST_IMAGE_FIELD_ID environment variables'
            });
            return false;
        }

        return await setCustomFieldsSequential(subscriberId, fields);
    }

    /**
     * Set ready state with script data - Called when worker completes
     * 
     * Updates sc_last_script, sc_last_image, and sc_status = "Ready".
     * User can then "pull" this data by typing "Hi".
     * 
     * @param subscriberId - The subscriber's ManyChat ID
     * @param scriptText - The generated script text content
     * @param imageUrl - The ImgBB URL to the script image
     * @returns true if successful, false otherwise
     */
    async setReadyState(
        subscriberId: string,
        scriptText: string,
        imageUrl: string
    ): Promise<boolean> {
        logger.info('[ManyChatState] Setting ready state', {
            subscriberId,
            scriptLength: scriptText.length,
            hasImage: !!imageUrl
        });

        // Build fields array
        const fields: Array<{ field_id: number; field_value: string }> = [];

        // sc_last_script = scriptText
        if (FIELD_IDS.SC_LAST_SCRIPT) {
            fields.push({
                field_id: parseInt(FIELD_IDS.SC_LAST_SCRIPT, 10),
                field_value: scriptText
            });
        }

        // sc_last_image = imageUrl
        if (FIELD_IDS.SC_LAST_IMAGE) {
            fields.push({
                field_id: parseInt(FIELD_IDS.SC_LAST_IMAGE, 10),
                field_value: imageUrl
            });
        }

        // sc_status = "Ready"
        if (FIELD_IDS.SC_STATUS) {
            fields.push({
                field_id: parseInt(FIELD_IDS.SC_STATUS, 10),
                field_value: ScriptStatus.READY
            });
        }

        if (fields.length === 0) {
            logger.warn('[ManyChatState] No field IDs configured, skipping ready state update');
            return false;
        }

        const success = await setCustomFieldsSequential(subscriberId, fields);

        if (success) {
            logger.info('[ManyChatState] ✅ Ready state set successfully', { subscriberId });
        }

        return success;
    }

    /**
     * Set error state with friendly message - Called when worker fails
     * 
     * Updates sc_status = "Error" and sc_last_script with error message.
     * 
     * @param subscriberId - The subscriber's ManyChat ID
     * @param errorMessage - Friendly error message for the user
     * @returns true if successful, false otherwise
     */
    async setErrorState(
        subscriberId: string,
        errorMessage: string
    ): Promise<boolean> {
        logger.info('[ManyChatState] Setting error state', {
            subscriberId,
            errorMessage: errorMessage.substring(0, 100)
        });

        // Build fields array
        const fields: Array<{ field_id: number; field_value: string }> = [];

        // sc_last_script = error message
        if (FIELD_IDS.SC_LAST_SCRIPT) {
            fields.push({
                field_id: parseInt(FIELD_IDS.SC_LAST_SCRIPT, 10),
                field_value: errorMessage
            });
        }

        // sc_last_image = "-" (clear image)
        if (FIELD_IDS.SC_LAST_IMAGE) {
            fields.push({
                field_id: parseInt(FIELD_IDS.SC_LAST_IMAGE, 10),
                field_value: '-'
            });
        }

        // sc_status = "Error"
        if (FIELD_IDS.SC_STATUS) {
            fields.push({
                field_id: parseInt(FIELD_IDS.SC_STATUS, 10),
                field_value: ScriptStatus.ERROR
            });
        }

        if (fields.length === 0) {
            logger.warn('[ManyChatState] No field IDs configured, skipping error state update');
            return false;
        }

        return await setCustomFieldsSequential(subscriberId, fields);
    }

    /**
     * Set busy state for rate limiting - Called when user is rate limited
     * 
     * Updates sc_status = "Busy" and sc_last_script with retry info.
     * 
     * @param subscriberId - The subscriber's ManyChat ID
     * @param retryAfterSeconds - Seconds until user can retry
     * @returns true if successful, false otherwise
     */
    async setBusyState(
        subscriberId: string,
        retryAfterSeconds: number
    ): Promise<boolean> {
        const minutes = Math.ceil(retryAfterSeconds / 60);
        const message = `⏳ Slow down! You're sending requests too fast.\n\nPlease wait ${minutes} minute${minutes > 1 ? 's' : ''} before trying again.`;

        logger.info('[ManyChatState] Setting busy state (rate limited)', {
            subscriberId,
            retryAfterSeconds
        });

        // Build fields array
        const fields: Array<{ field_id: number; field_value: string }> = [];

        // sc_last_script = busy message
        if (FIELD_IDS.SC_LAST_SCRIPT) {
            fields.push({
                field_id: parseInt(FIELD_IDS.SC_LAST_SCRIPT, 10),
                field_value: message
            });
        }

        // sc_last_image = "-" (clear image)
        if (FIELD_IDS.SC_LAST_IMAGE) {
            fields.push({
                field_id: parseInt(FIELD_IDS.SC_LAST_IMAGE, 10),
                field_value: '-'
            });
        }

        // sc_status = "Busy"
        if (FIELD_IDS.SC_STATUS) {
            fields.push({
                field_id: parseInt(FIELD_IDS.SC_STATUS, 10),
                field_value: ScriptStatus.BUSY
            });
        }

        if (fields.length === 0) {
            logger.warn('[ManyChatState] No field IDs configured, skipping busy state update');
            return false;
        }

        return await setCustomFieldsSequential(subscriberId, fields);
    }

    /**
     * Get user-friendly error message based on error type
     * 
     * @param error - The error object or message
     * @param errorType - Optional error type classification
     * @returns Friendly error message
     */
    getFriendlyErrorMessage(error: Error | string, errorType?: string): string {
        const errorMessage = typeof error === 'string' ? error : error.message;

        // Private/inaccessible reel
        if (errorMessage.includes('private') || errorMessage.includes('not found') || errorMessage.includes('unavailable')) {
            return "⚠️ Oops! I couldn't access that Reel. Please make sure it's public and try again.";
        }

        // Reel too long
        if (errorMessage.includes('too long') || errorMessage.includes('duration') || errorMessage.includes('90')) {
            return "⚠️ That Reel is too long (over 90 seconds). Please try a shorter one!";
        }

        // Download failures
        if (errorType === 'download' || errorMessage.includes('download') || errorMessage.includes('yt-dlp')) {
            return "⚠️ Oops! I couldn't access that Reel. Please make sure it's public and the link is correct.";
        }

        // API/service failures
        if (errorType === 'api' || errorMessage.includes('Gemini') || errorMessage.includes('429')) {
            return "⚠️ Our AI is taking a quick break. Please try again in 30 seconds!";
        }

        // Timeout
        if (errorType === 'timeout' || errorMessage.includes('timeout')) {
            return "⚠️ The request took too long. Please try again with a shorter reel!";
        }

        // Generic error
        return "⚠️ Something went wrong. Please try again in a moment!";
    }

    /**
     * Check if the state service is properly configured
     * 
     * @returns Configuration status object
     */
    getConfigStatus(): {
        isConfigured: boolean;
        hasStatusField: boolean;
        hasScriptField: boolean;
        hasImageField: boolean;
    } {
        return {
            isConfigured: !!(FIELD_IDS.SC_STATUS || FIELD_IDS.SC_LAST_SCRIPT || FIELD_IDS.SC_LAST_IMAGE),
            hasStatusField: !!FIELD_IDS.SC_STATUS,
            hasScriptField: !!FIELD_IDS.SC_LAST_SCRIPT,
            hasImageField: !!FIELD_IDS.SC_LAST_IMAGE
        };
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// SINGLETON INSTANCE
// ═══════════════════════════════════════════════════════════════════════════

/** Singleton service instance */
export const manychatStateService = new ManyChatStateService();

/** Export class for testing */
export { ManyChatStateService };

export default manychatStateService;
