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
 * 
 * IMPORTANT: These are the ONLY allowed states per spec.
 * ManyChat automation relies on these exact values.
 * DO NOT add new states without updating ManyChat flows.
 */
export enum ScriptStatus {
    /** Initial state - no active session */
    IDLE = 'IDLE',
    /** Waiting for user to provide their idea after sending reel */
    AWAITING_IDEA = 'AWAITING_IDEA',
    /** Backend is processing the request (async job running) */
    PROCESSING = 'PROCESSING',
    /** Script is ready - ManyChat should deliver and set to DELIVERED */
    READY = 'READY',
    /** Script has been delivered to user - allows variation requests */
    DELIVERED = 'DELIVERED',
    /** An error occurred - show sc_prompt_message */
    ERROR = 'ERROR',
    /** Rate limited - user should try again later */
    BUSY = 'BUSY',
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
    SC_REEL_URL: config.MANYCHAT_SC_REEL_URL_FIELD_ID || '',
    SC_PROMPT_MESSAGE: config.MANYCHAT_SC_PROMPT_MESSAGE_FIELD_ID || '',
    SC_COPY_URL: config.MANYCHAT_SC_COPY_URL_FIELD_ID || '',
    SC_ERROR_CODE: (config as any).MANYCHAT_SC_ERROR_CODE_FIELD_ID || '',
    // V2 Field Names (alternative)
    AI_GENERATED_SCRIPT: (config as any).MANYCHAT_AI_GENERATED_SCRIPT_FIELD_ID || '',
    SCRIPT_IMAGE: (config as any).MANYCHAT_SCRIPT_IMAGE_FIELD_ID || '',
    SCRIPT_COPY_LINK: (config as any).MANYCHAT_SCRIPT_COPY_LINK_FIELD_ID || '',
};

// ═══════════════════════════════════════════════════════════════════════════
// PROMPT MESSAGES (ManyChat automation displays these)
// ═══════════════════════════════════════════════════════════════════════════

const PROMPT_MESSAGES = {
    AWAITING_IDEA: "🎬 Got the reel! Now what's your idea?\n\nTell me the vibe you want - or just say \"generate\" and I'll pick something fire 🔥",
    PROCESSING: "⚡ Creating your script... This takes about 30 seconds!",
    PROCESSING_VARIATION: (num: number) => `🔄 Creating version #${num}... Taking a fresh angle! ✨`,
    READY: "🎉 Your script is ready! Tap the image to view or use the copy link below.",
    ERROR_GENERIC: "😔 Something went wrong. Please try again!",
    ERROR_PRIVATE_REEL: "⚠️ Oops! I couldn't access that Reel. Please make sure it's public and try again.",
    ERROR_TOO_LONG: "⚠️ That Reel is too long (over 90 seconds). Please try a shorter one!",
    ERROR_DOWNLOAD: "⚠️ Couldn't download that Reel. Please check the link and try again.",
    ERROR_API: "⚠️ Our AI is taking a quick break. Please try again in 30 seconds!",
    RATE_LIMITED: (minutes: number) => `⏳ You've hit the limit! Please wait ${minutes} minute${minutes > 1 ? 's' : ''} before trying again.`,
    WELCOME: "👋 Welcome to ScriptFlow! Send me any Instagram reel link to get started! 🚀",
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
     * Initialize IDLE state for first-time users
     * 
     * Per spec INITIALIZATION RULE:
     * - IF sc_status has no value → set sc_status = IDLE
     * - DO NOT reinitialize existing users
     * 
     * This should be called on first contact with a new subscriber.
     * 
     * @param subscriberId - The subscriber's ManyChat ID
     * @returns true if initialized, false if already had a state
     */
    async initializeIdleState(subscriberId: string): Promise<boolean> {
        logger.info('[ManyChatState] Checking if user needs IDLE initialization', { subscriberId });

        // Note: We can't check if field is empty via API, so we always set IDLE
        // ManyChat automation should only call this on truly new users
        // This is safe because IDLE just means "ready for new input"

        if (!FIELD_IDS.SC_STATUS) {
            logger.warn('[ManyChatState] SC_STATUS field not configured, skipping IDLE init');
            return false;
        }

        const success = await setCustomField(
            subscriberId,
            FIELD_IDS.SC_STATUS,
            ScriptStatus.IDLE
        );

        if (success) {
            logger.info('[ManyChatState] ✅ User initialized to IDLE state', { subscriberId });
        }

        return success;
    }

    /**
     * Initialize processing state - Called when webhook queues a job
     * 
     * Sets sc_status to "Processing", prompt message, and clears old data.
     * ManyChat automation reads sc_prompt_message to show "Creating..." message.
     * 
     * @param subscriberId - The subscriber's ManyChat ID
     * @param isVariation - Whether this is a variation (for custom message)
     * @param variationNumber - The variation number (for custom message)
     * @returns true if successful, false otherwise
     */
    async initializeProcessing(
        subscriberId: string,
        isVariation: boolean = false,
        variationNumber: number = 0
    ): Promise<boolean> {
        logger.info('[ManyChatState] Initializing processing state', { subscriberId, isVariation, variationNumber });

        // Build fields array with available field IDs
        const fields: Array<{ field_id: number; field_value: string }> = [];

        // sc_status = "Processing"
        if (FIELD_IDS.SC_STATUS) {
            fields.push({
                field_id: parseInt(FIELD_IDS.SC_STATUS, 10),
                field_value: ScriptStatus.PROCESSING
            });
        }

        // sc_prompt_message = contextual message
        if (FIELD_IDS.SC_PROMPT_MESSAGE) {
            const message = isVariation && variationNumber > 0
                ? PROMPT_MESSAGES.PROCESSING_VARIATION(variationNumber)
                : PROMPT_MESSAGES.PROCESSING;
            fields.push({
                field_id: parseInt(FIELD_IDS.SC_PROMPT_MESSAGE, 10),
                field_value: message
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

        // sc_copy_url = "-" (clear old copy URL)
        if (FIELD_IDS.SC_COPY_URL) {
            fields.push({
                field_id: parseInt(FIELD_IDS.SC_COPY_URL, 10),
                field_value: '-'
            });
        }

        // ══════════════════════════════════════════════════════════════════
        // V2 FIELDS CLEANUP
        // Explicitly clear V2 output fields to ensure "Value Changed" triggers fire
        // ══════════════════════════════════════════════════════════════════

        // ai_generated_script = "-" (clear old script)
        if (FIELD_IDS.AI_GENERATED_SCRIPT) {
            fields.push({
                field_id: parseInt(FIELD_IDS.AI_GENERATED_SCRIPT, 10),
                field_value: '-'
            });
        }

        // script_image = "-" (clear old image)
        if (FIELD_IDS.SCRIPT_IMAGE) {
            fields.push({
                field_id: parseInt(FIELD_IDS.SCRIPT_IMAGE, 10),
                field_value: '-'
            });
        }

        // script_copy_link = "-" (clear old link)
        if (FIELD_IDS.SCRIPT_COPY_LINK) {
            fields.push({
                field_id: parseInt(FIELD_IDS.SCRIPT_COPY_LINK, 10),
                field_value: '-'
            });
        }

        if (fields.length === 0) {
            logger.warn('[ManyChatState] No field IDs configured, skipping initialization', {
                subscriberId,
                hint: 'Set MANYCHAT_SC_STATUS_FIELD_ID, MANYCHAT_SC_LAST_SCRIPT_FIELD_ID, etc.'
            });
            return false;
        }

        return await setCustomFieldsSequential(subscriberId, fields);
    }

    /**
     * Set ready state with script data - Called when worker completes
     * 
     * CRITICAL: Order of updates matters!
     * Per spec READY STATE RULE, fields must be set in this order:
     * 1. sc_last_image (image URL)
     * 2. sc_last_script (script text)
     * 3. sc_copy_url (copy link)
     * 4. ONLY THEN sc_status = READY
     * 
     * This prevents ManyChat from trying to deliver before data is available.
     * 
     * @param subscriberId - The subscriber's ManyChat ID
     * @param scriptText - The generated script text content
     * @param imageUrl - The ImgBB URL to the script image
     * @param copyUrl - The URL for copying the script
     * @returns true if successful, false otherwise
     */
    async setReadyState(
        subscriberId: string,
        scriptText: string,
        imageUrl: string,
        copyUrl?: string
    ): Promise<boolean> {
        logger.info('[ManyChatState] Setting ready state (ORDERED)', {
            subscriberId,
            scriptLength: scriptText.length,
            hasImage: !!imageUrl,
            hasCopyUrl: !!copyUrl
        });

        // ══════════════════════════════════════════════════════════════════
        // CRITICAL: Set fields in STRICT ORDER per spec
        // sc_last_image → sc_last_script → sc_copy_url → sc_status = READY
        // Status MUST be set LAST to prevent race conditions
        // ══════════════════════════════════════════════════════════════════

        let allSuccess = true;

        // STEP 1: sc_last_image = imageUrl
        if (FIELD_IDS.SC_LAST_IMAGE) {
            const success = await setCustomField(
                subscriberId,
                FIELD_IDS.SC_LAST_IMAGE,
                imageUrl
            );
            if (!success) {
                logger.warn('[ManyChatState] Failed to set sc_last_image');
                allSuccess = false;
            }
        }

        // STEP 2: sc_last_script = scriptText
        if (FIELD_IDS.SC_LAST_SCRIPT) {
            const success = await setCustomField(
                subscriberId,
                FIELD_IDS.SC_LAST_SCRIPT,
                scriptText
            );
            if (!success) {
                logger.warn('[ManyChatState] Failed to set sc_last_script');
                allSuccess = false;
            }
        }

        // STEP 3: sc_copy_url = copyUrl
        if (FIELD_IDS.SC_COPY_URL && copyUrl) {
            const success = await setCustomField(
                subscriberId,
                FIELD_IDS.SC_COPY_URL,
                copyUrl
            );
            if (!success) {
                logger.warn('[ManyChatState] Failed to set sc_copy_url');
                allSuccess = false;
            }
        }

        // STEP 4: sc_prompt_message = ready message
        if (FIELD_IDS.SC_PROMPT_MESSAGE) {
            await setCustomField(
                subscriberId,
                FIELD_IDS.SC_PROMPT_MESSAGE,
                PROMPT_MESSAGES.READY
            );
        }

        // STEP 5 (LAST): sc_status = READY
        // This is set LAST so ManyChat only sees READY after all data is in place
        if (FIELD_IDS.SC_STATUS) {
            const success = await setCustomField(
                subscriberId,
                FIELD_IDS.SC_STATUS,
                ScriptStatus.READY
            );
            if (!success) {
                logger.error('[ManyChatState] CRITICAL: Failed to set sc_status = READY');
                allSuccess = false;
            }
        }

        if (allSuccess) {
            logger.info('[ManyChatState] ✅ Ready state set successfully (ordered)', { subscriberId });
        } else {
            logger.warn('[ManyChatState] Ready state set with some failures', { subscriberId });
        }

        return allSuccess;
    }


    /**
     * Set error state with friendly message - Called when worker fails
     * 
     * Per spec ERROR RULE:
     * - sc_status = ERROR
     * - sc_prompt_message = human-readable message
     * - sc_error_code = error code for debugging
     * 
     * @param subscriberId - The subscriber's ManyChat ID
     * @param errorMessage - Friendly error message for the user
     * @param errorCode - Optional error code for debugging
     * @returns true if successful, false otherwise
     */
    async setErrorState(
        subscriberId: string,
        errorMessage: string,
        errorCode?: string
    ): Promise<boolean> {
        logger.info('[ManyChatState] Setting error state', {
            subscriberId,
            errorMessage: errorMessage.substring(0, 100),
            errorCode
        });

        let allSuccess = true;

        // STEP 1: sc_prompt_message = error message (human-readable)
        if (FIELD_IDS.SC_PROMPT_MESSAGE) {
            const success = await setCustomField(
                subscriberId,
                FIELD_IDS.SC_PROMPT_MESSAGE,
                errorMessage
            );
            if (!success) allSuccess = false;
        }

        // STEP 2: sc_error_code = error code (for debugging)
        if (FIELD_IDS.SC_ERROR_CODE && errorCode) {
            const success = await setCustomField(
                subscriberId,
                FIELD_IDS.SC_ERROR_CODE,
                errorCode
            );
            if (!success) allSuccess = false;
        }

        // STEP 3: sc_last_script = error message (fallback display)
        if (FIELD_IDS.SC_LAST_SCRIPT) {
            const success = await setCustomField(
                subscriberId,
                FIELD_IDS.SC_LAST_SCRIPT,
                errorMessage
            );
            if (!success) allSuccess = false;
        }

        // STEP 4: sc_last_image = "-" (clear image)
        if (FIELD_IDS.SC_LAST_IMAGE) {
            await setCustomField(subscriberId, FIELD_IDS.SC_LAST_IMAGE, '-');
        }

        // STEP 5 (LAST): sc_status = ERROR
        if (FIELD_IDS.SC_STATUS) {
            const success = await setCustomField(
                subscriberId,
                FIELD_IDS.SC_STATUS,
                ScriptStatus.ERROR
            );
            if (!success) {
                logger.error('[ManyChatState] CRITICAL: Failed to set sc_status = ERROR');
                allSuccess = false;
            }
        }

        return allSuccess;
    }

    /**
     * Set awaiting idea state - Called when user sends reel without idea
     * 
     * Updates sc_status = "AwaitingIdea", stores reel URL, and sets prompt message.
     * ManyChat automation reads these fields and displays the prompt.
     * 
     * @param subscriberId - The subscriber's ManyChat ID
     * @param reelUrl - The reel URL that was received
     * @returns true if successful, false otherwise
     */
    async setAwaitingIdeaState(
        subscriberId: string,
        reelUrl?: string
    ): Promise<boolean> {
        logger.info('[ManyChatState] Setting awaiting idea state', {
            subscriberId,
            reelUrl: reelUrl?.substring(0, 50)
        });

        // Build fields array
        const fields: Array<{ field_id: number; field_value: string }> = [];

        // sc_status = "AwaitingIdea"
        if (FIELD_IDS.SC_STATUS) {
            fields.push({
                field_id: parseInt(FIELD_IDS.SC_STATUS, 10),
                field_value: ScriptStatus.AWAITING_IDEA
            });
        }

        // sc_prompt_message = prompt for idea
        if (FIELD_IDS.SC_PROMPT_MESSAGE) {
            fields.push({
                field_id: parseInt(FIELD_IDS.SC_PROMPT_MESSAGE, 10),
                field_value: PROMPT_MESSAGES.AWAITING_IDEA
            });
        }

        // sc_reel_url = the reel being processed
        if (FIELD_IDS.SC_REEL_URL && reelUrl) {
            fields.push({
                field_id: parseInt(FIELD_IDS.SC_REEL_URL, 10),
                field_value: reelUrl
            });
        }

        // Clear old script data
        if (FIELD_IDS.SC_LAST_SCRIPT) {
            fields.push({
                field_id: parseInt(FIELD_IDS.SC_LAST_SCRIPT, 10),
                field_value: '-'
            });
        }

        if (FIELD_IDS.SC_LAST_IMAGE) {
            fields.push({
                field_id: parseInt(FIELD_IDS.SC_LAST_IMAGE, 10),
                field_value: '-'
            });
        }

        // Clear old copy URL
        if (FIELD_IDS.SC_COPY_URL) {
            fields.push({
                field_id: parseInt(FIELD_IDS.SC_COPY_URL, 10),
                field_value: '-'
            });
        }

        if (fields.length === 0) {
            logger.warn('[ManyChatState] No field IDs configured, skipping awaiting idea state update');
            return false;
        }

        const success = await setCustomFieldsSequential(subscriberId, fields);

        if (success) {
            logger.info('[ManyChatState] ✅ Awaiting idea state set successfully', { subscriberId });
        }

        return success;
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

    /**
     * V2 Ready State - Uses V2 field names
     * 
     * Updates ManyChat custom fields using V2 naming convention:
     * - ai_generated_script -> Script text
     * - script_image -> Image URL
     * - script_copy_link -> Webpage URL
     * 
     * Falls back to V3 field names if V2 not configured.
     * 
     * @param subscriberId - The subscriber's ManyChat ID
     * @param scriptText - The generated script text content
     * @param imageUrl - The image URL
     * @param copyUrl - The webpage URL for copying
     * @returns true if successful, false otherwise
     */
    async setReadyStateV2(
        subscriberId: string,
        scriptText: string,
        imageUrl: string,
        copyUrl?: string
    ): Promise<boolean> {
        logger.info('[ManyChatState] Setting V2 ready state', {
            subscriberId,
            scriptLength: scriptText.length,
            hasImage: !!imageUrl,
            hasCopyUrl: !!copyUrl
        });

        let allSuccess = true;

        // Use V2 field names if configured, otherwise fall back to V3 names
        const scriptFieldId = FIELD_IDS.AI_GENERATED_SCRIPT || FIELD_IDS.SC_LAST_SCRIPT;
        const imageFieldId = FIELD_IDS.SCRIPT_IMAGE || FIELD_IDS.SC_LAST_IMAGE;
        const copyFieldId = FIELD_IDS.SCRIPT_COPY_LINK || FIELD_IDS.SC_COPY_URL;

        // STEP 1: script_image (ai_generated_script) = imageUrl
        if (imageFieldId) {
            const success = await setCustomField(
                subscriberId,
                imageFieldId,
                imageUrl
            );
            if (!success) {
                logger.warn('[ManyChatState] V2: Failed to set script_image');
                allSuccess = false;
            }
        }

        // STEP 2: ai_generated_script = scriptText
        if (scriptFieldId) {
            const success = await setCustomField(
                subscriberId,
                scriptFieldId,
                scriptText
            );
            if (!success) {
                logger.warn('[ManyChatState] V2: Failed to set ai_generated_script');
                allSuccess = false;
            }
        }

        // STEP 3: script_copy_link = copyUrl
        if (copyFieldId && copyUrl) {
            const success = await setCustomField(
                subscriberId,
                copyFieldId,
                copyUrl
            );
            if (!success) {
                logger.warn('[ManyChatState] V2: Failed to set script_copy_link');
                allSuccess = false;
            }
        }

        // STEP 4: sc_status = READY (if configured - for V3 compatibility)
        if (FIELD_IDS.SC_STATUS) {
            const success = await setCustomField(
                subscriberId,
                FIELD_IDS.SC_STATUS,
                ScriptStatus.READY
            );
            if (!success) {
                logger.warn('[ManyChatState] V2: Failed to set sc_status = READY');
                // Not critical for V2 - don't mark as failure
            }
        }

        if (allSuccess) {
            logger.info('[ManyChatState] ✅ V2 Ready state set successfully', { subscriberId });
        } else {
            logger.warn('[ManyChatState] V2 Ready state set with some failures', { subscriberId });
        }

        return allSuccess;
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
