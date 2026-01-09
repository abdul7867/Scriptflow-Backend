/**
 * ManyChat Flow Service
 * 
 * Handles triggering ManyChat flows via API.
 * Centralizes all ManyChat communication logic.
 * 
 * Features:
 * - Enum-based flow definitions
 * - Template-based message generation
 * - Retry logic for API calls
 * - Logging and error handling
 * 
 * @author ScriptFlow Team
 * @version 1.0.0
 */

import axios from 'axios';
import { logger } from '../../utils/logger';
import { config } from '../../config';

// ═══════════════════════════════════════════════════════════════════════════
// FLOW ENUM
// ═══════════════════════════════════════════════════════════════════════════

/**
 * ManyChat flows that can be triggered.
 * Each flow corresponds to a specific user journey/response.
 */
export enum ManyChatFlow {
    // ─────────────────────────────────────────────────────────────────────────
    // WELCOME & HELP
    // ─────────────────────────────────────────────────────────────────────────

    /** Initial welcome message with instructions */
    WELCOME_HELP = 'WELCOME_HELP',

    /** Generic help message based on current state */
    GENERIC_HELP = 'GENERIC_HELP',

    /** Help message when user has a script and can do actions */
    FEEDBACK_HELP = 'FEEDBACK_HELP',

    // ─────────────────────────────────────────────────────────────────────────
    // PROMPTS
    // ─────────────────────────────────────────────────────────────────────────

    /** Prompt user to provide their idea after submitting a reel */
    PROMPT_IDEA = 'PROMPT_IDEA',

    /** Prompt user to send a reel URL */
    PROMPT_REEL = 'PROMPT_REEL',

    // ─────────────────────────────────────────────────────────────────────────
    // JOB STATUS
    // ─────────────────────────────────────────────────────────────────────────

    /** Acknowledgment that job is queued */
    JOB_QUEUED = 'JOB_QUEUED',

    /** Job completed successfully - deliver script */
    JOB_COMPLETED = 'JOB_COMPLETED',

    /** Job failed - show error message */
    JOB_FAILED = 'JOB_FAILED',

    // ─────────────────────────────────────────────────────────────────────────
    // ERRORS & LIMITS
    // ─────────────────────────────────────────────────────────────────────────

    /** User has exceeded rate limit */
    RATE_LIMITED = 'RATE_LIMITED',

    /** User is blocked */
    BLOCKED_USER = 'BLOCKED_USER',

    /** Invalid action for current state */
    INVALID_ACTION = 'INVALID_ACTION',

    /** Generic error occurred */
    ERROR = 'ERROR',

    // ─────────────────────────────────────────────────────────────────────────
    // COPY FLOW
    // ─────────────────────────────────────────────────────────────────────────

    /** Send copy link to user */
    COPY_SCRIPT = 'COPY_SCRIPT',

    /** No script available to copy */
    NOTHING_TO_COPY = 'NOTHING_TO_COPY',

    // ─────────────────────────────────────────────────────────────────────────
    // VARIATION FLOW
    // ─────────────────────────────────────────────────────────────────────────

    /** No previous reel to create variation from */
    NO_PREVIOUS_REEL = 'NO_PREVIOUS_REEL',

    /** Soft limit warning for variations */
    VARIATION_SOFT_LIMIT = 'VARIATION_SOFT_LIMIT',
}

// ═══════════════════════════════════════════════════════════════════════════
// FLOW CONTEXT TYPES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Context data for flow triggering
 */
export interface FlowContext {
    // Rate limit context
    resetInMinutes?: number;
    limit?: number;
    remaining?: number;

    // Job context
    jobId?: string;
    isVariation?: boolean;
    variationNumber?: number;

    // Script context
    scriptUrl?: string;
    scriptId?: string;
    scriptText?: string;
    imageUrl?: string;

    // Reel context
    reelUrl?: string;

    // Error context
    errorMessage?: string;
    currentState?: string;
    attemptedAction?: string;
    message?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// MESSAGE TEMPLATES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Generate message content for a flow
 */
function getFlowMessage(flow: ManyChatFlow, context: FlowContext): string {
    switch (flow) {
        // ─────────────────────────────────────────────────────────────────────────
        // WELCOME & HELP
        // ─────────────────────────────────────────────────────────────────────────

        case ManyChatFlow.WELCOME_HELP:
            return (
                "👋 Welcome to ScriptFlow! I turn Instagram reels into custom scripts for YOUR content.\n\n" +
                "🎬 **How it works:**\n" +
                "1️⃣ Send me any Instagram reel link\n" +
                "2️⃣ Tell me your content idea (or just say 'generate')\n" +
                "3️⃣ Get a custom script in seconds! ✨\n\n" +
                "🔥 **What you can do:**\n" +
                "• Say 'another' or 'redo' for different variations\n" +
                "• Say 'copy' to get the script as text\n" +
                "• Say 'extract' to get the original reel's transcript\n\n" +
                "Ready? Just paste any Instagram reel link to start! 🚀"
            );

        case ManyChatFlow.GENERIC_HELP:
            return (
                "🤔 I didn't quite understand that. Here's what I can help with:\n\n" +
                "✨ **To create a script:**\n" +
                "   → Paste an Instagram reel link\n\n" +
                "🔄 **If you already have a script:**\n" +
                "   → Say 'another', 'redo', or 'more' for variations\n" +
                "   → Say 'copy' or 'link' to get the text\n" +
                "   → Say 'extract' or 'original' for the reel's transcript\n\n" +
                "💡 Tip: Just paste a reel link to start fresh!"
            );

        case ManyChatFlow.FEEDBACK_HELP:
            return (
                "🤔 Not sure what you meant! Here's what you can do now:\n\n" +
                "🔄 **Want a different version?**\n" +
                "   → Say 'another', 'redo', 'again', or 'more'\n\n" +
                "📋 **Get the script text:**\n" +
                "   → Say 'copy', 'link', or 'share'\n\n" +
                "📝 **Get the original transcript:**\n" +
                "   → Say 'extract', 'original', or 'transcript'\n\n" +
                "🎬 **Start fresh with a new reel:**\n" +
                "   → Just paste any Instagram reel link!\n\n" +
                "💡 Try one of these commands!"
            );

        // ─────────────────────────────────────────────────────────────────────────
        // PROMPTS
        // ─────────────────────────────────────────────────────────────────────────

        case ManyChatFlow.PROMPT_IDEA:
            return (
                "🎬 Got it! Now what's your idea?\n\n" +
                "Tell me the vibe you want - or just say \"generate\" and I'll pick something fire 🔥"
            );

        case ManyChatFlow.PROMPT_REEL:
            return (
                "� **Send me an Instagram reel link to get started!**\n\n" +
                "Just paste any reel URL like:\n" +
                "instagram.com/reel/ABC123/\n\n" +
                "I'll analyze it and create a custom script for you! ✨"
            );

        // ─────────────────────────────────────────────────────────────────────────
        // JOB STATUS
        // ─────────────────────────────────────────────────────────────────────────

        case ManyChatFlow.JOB_QUEUED:
            if (context.isVariation && context.variationNumber) {
                const num = context.variationNumber;
                if (num === 2) {
                    return "🔄 Creating your 2nd version - taking a fresh angle! ✨";
                } else if (num === 3) {
                    return "🔄 Version #3 coming up - going a different direction! 🎯";
                } else if (num === 4) {
                    return "🔄 Version #4 in progress - exploring new territory! 🚀";
                } else if (num === 5) {
                    return "🔄 Version #5 brewing - switching up the style! 🔥";
                } else {
                    return `🔄 Creating version #${num} for you!`;
                }
            }
            return "✨ Analyzing your reel... Magic incoming!";

        case ManyChatFlow.JOB_COMPLETED:
            return "🎉 Your script is ready!";

        case ManyChatFlow.JOB_FAILED:
            return (
                "😔 Sorry, something went wrong while creating your script.\n\n" +
                `${context.errorMessage || 'Please try again!'}`
            );

        // ─────────────────────────────────────────────────────────────────────────
        // ERRORS & LIMITS
        // ─────────────────────────────────────────────────────────────────────────

        case ManyChatFlow.RATE_LIMITED:
            return (
                `⏰ You've used all ${context.limit || 10} scripts this hour!\n\n` +
                `🔄 Reset in ${context.resetInMinutes || 60} minute${(context.resetInMinutes || 60) !== 1 ? 's' : ''}.\n\n` +
                "💡 Want more? Reply UPGRADE to unlock 50 scripts/hour!"
            );

        case ManyChatFlow.BLOCKED_USER:
            return "🚫 Your access has been temporarily suspended. Please contact support if you believe this is an error.";

        case ManyChatFlow.INVALID_ACTION:
            return context.message || "⚠️ This action isn't available right now. Try sending a reel link!";

        case ManyChatFlow.ERROR:
            return context.errorMessage || "😔 Something went wrong. Please try again!";

        // ─────────────────────────────────────────────────────────────────────────
        // COPY FLOW
        // ─────────────────────────────────────────────────────────────────────────

        case ManyChatFlow.COPY_SCRIPT:
            return `📋 Tap to copy your script:\n${context.scriptUrl || ''}`;

        case ManyChatFlow.NOTHING_TO_COPY:
            return "🤔 No script to copy yet! Send a reel first and I'll create one for you.";

        // ─────────────────────────────────────────────────────────────────────────
        // VARIATION FLOW
        // ─────────────────────────────────────────────────────────────────────────

        case ManyChatFlow.NO_PREVIOUS_REEL:
            return "🤔 I don't have a previous reel to create a variation from. Send me a reel link first!";

        case ManyChatFlow.VARIATION_SOFT_LIMIT:
            return (
                `💡 Tip: You've tried ${context.variationNumber || 5}+ variations!\n` +
                "For better results, try a fresh idea or new reel."
            );

        default:
            return "Something went wrong. Please try again!";
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

const API_TIMEOUT_MS = 30000;
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 1000;

// ═══════════════════════════════════════════════════════════════════════════
// MANYCHAT FLOW SERVICE CLASS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * ManyChatFlowService - Handles triggering ManyChat flows.
 * 
 * This service provides a clean interface for triggering ManyChat
 * responses without exposing API details to the rest of the application.
 */
class ManyChatFlowService {

    private apiKey: string | null;
    private channel: string; // 'fb' for Facebook Messenger, 'ig' for Instagram
    private apiBaseUrl: string;

    constructor() {
        this.apiKey = config.MANYCHAT_API_KEY || null;
        this.channel = config.MANYCHAT_CHANNEL || 'ig';
        this.apiBaseUrl = `https://api.manychat.com/${this.channel}`;

        logger.info('[ManyChatFlow] Initialized', {
            channel: this.channel,
            apiBaseUrl: this.apiBaseUrl,
            hasApiKey: !!this.apiKey
        });
    }

    /**
     * Trigger a ManyChat flow for a subscriber.
     * 
     * @param subscriberId - The subscriber's ManyChat ID
     * @param flow - The flow to trigger
     * @param context - Optional context data for the flow
     * @returns true if successful, false otherwise
     */
    async triggerFlow(
        subscriberId: string,
        flow: ManyChatFlow,
        context: FlowContext = {}
    ): Promise<boolean> {
        if (!this.apiKey) {
            logger.warn('[ManyChatFlow] No API key configured, skipping flow trigger', {
                flow,
                subscriberId
            });
            return false;
        }

        logger.info('[ManyChatFlow] Triggering flow', {
            flow,
            subscriberId,
            hasContext: Object.keys(context).length > 0
        });

        try {
            // Generate message content
            const message = getFlowMessage(flow, context);

            // Send text message
            const success = await this.sendTextMessage(subscriberId, message);

            if (success) {
                logger.info('[ManyChatFlow] Flow triggered successfully', { flow, subscriberId });
            } else {
                logger.warn('[ManyChatFlow] Flow trigger failed', { flow, subscriberId });
            }

            return success;
        } catch (error) {
            logger.error('[ManyChatFlow] Error triggering flow', {
                flow,
                subscriberId,
                error
            });
            return false;
        }
    }

    /**
     * Send a text message to a subscriber
     */
    private async sendTextMessage(
        subscriberId: string,
        text: string,
        retryCount: number = 0
    ): Promise<boolean> {
        try {
            // Validate subscriber ID is numeric (ManyChat requirement)
            const subscriberIdNum = parseInt(subscriberId, 10);
            if (isNaN(subscriberIdNum)) {
                logger.warn('[ManyChatFlow] Invalid subscriber ID (not numeric)', { subscriberId });
                return false;
            }

            const sendContentUrl = `${this.apiBaseUrl}/sending/sendContent`;

            await axios.post(sendContentUrl, {
                subscriber_id: subscriberIdNum,
                data: {
                    version: "v2",
                    content: {
                        messages: [{
                            type: "text",
                            text: text
                        }]
                    }
                },
                message_tag: "POST_PURCHASE_UPDATE"
            }, {
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json'
                },
                timeout: API_TIMEOUT_MS
            });

            return true;
        } catch (error: any) {
            // Log detailed error info for 400 errors
            if (error.response?.status === 400) {
                logger.error('[ManyChatFlow] API returned 400 Bad Request', {
                    subscriberId,
                    responseData: error.response?.data,
                    requestPayload: {
                        subscriber_id: subscriberId,
                        message_tag: 'POST_PURCHASE_UPDATE'
                    }
                });

                // Don't retry 400 errors - they're usually permanent (invalid subscriber, etc.)
                return false;
            }

            // Retry logic for transient errors (5xx, network issues)
            if (retryCount < MAX_RETRIES) {
                logger.warn(`[ManyChatFlow] Retrying message send (attempt ${retryCount + 1})`, {
                    subscriberId,
                    error: error.message
                });

                await this.delay(RETRY_DELAY_MS * (retryCount + 1));
                return this.sendTextMessage(subscriberId, text, retryCount + 1);
            }

            logger.error('[ManyChatFlow] Failed to send message after retries', {
                subscriberId,
                error: error.message
            });

            return false;
        }
    }

    /**
     * Send a carousel message with script images
     */
    async sendScriptCarousel(
        subscriberId: string,
        hookImageUrl: string,
        bodyImageUrl: string,
        ctaImageUrl: string,
        copyUrl: string
    ): Promise<boolean> {
        if (!this.apiKey) {
            logger.warn('[ManyChatFlow] No API key configured, skipping carousel');
            return false;
        }

        try {
            // Validate subscriber ID is numeric
            const subscriberIdNum = parseInt(subscriberId, 10);
            if (isNaN(subscriberIdNum)) {
                logger.warn('[ManyChatFlow] Invalid subscriber ID (not numeric)', { subscriberId });
                return false;
            }

            const sendContentUrl = `${this.apiBaseUrl}/sending/sendContent`;

            const elements = [
                {
                    title: '🎬 HOOK',
                    subtitle: '0-3 seconds • Opening pattern interrupt',
                    image_url: hookImageUrl,
                    action_url: `${copyUrl}#hook`,
                    buttons: [{ type: 'web_url', title: '📋 Copy Hook', url: `${copyUrl}#hook` }]
                },
                {
                    title: '📝 BODY',
                    subtitle: '3-15 seconds • Main content delivery',
                    image_url: bodyImageUrl,
                    action_url: `${copyUrl}#body`,
                    buttons: [{ type: 'web_url', title: '📋 Copy Body', url: `${copyUrl}#body` }]
                },
                {
                    title: '🎯 CTA',
                    subtitle: '15-20 seconds • Call to action',
                    image_url: ctaImageUrl,
                    action_url: `${copyUrl}#cta`,
                    buttons: [{ type: 'web_url', title: '📋 Copy CTA', url: `${copyUrl}#cta` }]
                }
            ];

            await axios.post(sendContentUrl, {
                subscriber_id: subscriberIdNum,
                data: {
                    version: "v2",
                    content: {
                        type: "cards",
                        elements,
                        image_aspect_ratio: "square"
                    }
                },
                message_tag: "POST_PURCHASE_UPDATE"
            }, {
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json'
                },
                timeout: API_TIMEOUT_MS
            });

            // Send copy link as follow-up
            await this.sendTextMessage(subscriberId, `📋 Tap to copy your script:\n${copyUrl}`);

            logger.info('[ManyChatFlow] Carousel sent successfully', { subscriberId });
            return true;

        } catch (error: any) {
            logger.error('[ManyChatFlow] Failed to send carousel', {
                subscriberId,
                error: error.message
            });
            return false;
        }
    }

    /**
     * Update a custom field for a subscriber
     */
    async setCustomField(
        subscriberId: string,
        fieldId: string,
        fieldValue: string
    ): Promise<boolean> {
        if (!this.apiKey) {
            logger.warn('[ManyChatFlow] No API key configured, skipping field update');
            return false;
        }

        try {
            const setFieldUrl = `${this.apiBaseUrl}/subscriber/setCustomField`;

            const subscriberIdInt = parseInt(subscriberId, 10);
            const fieldIdInt = parseInt(fieldId, 10);

            if (isNaN(subscriberIdInt) || isNaN(fieldIdInt)) {
                logger.error('[ManyChatFlow] Invalid subscriber or field ID', {
                    subscriberId,
                    fieldId
                });
                return false;
            }

            await axios.post(setFieldUrl, {
                subscriber_id: subscriberIdInt,
                field_id: fieldIdInt,
                field_value: fieldValue
            }, {
                headers: {
                    'Authorization': `Bearer ${this.apiKey}`,
                    'Content-Type': 'application/json'
                },
                timeout: API_TIMEOUT_MS
            });

            logger.info('[ManyChatFlow] Custom field updated', {
                subscriberId,
                fieldId
            });

            return true;
        } catch (error: any) {
            logger.error('[ManyChatFlow] Failed to update custom field', {
                subscriberId,
                fieldId,
                error: error.message
            });
            return false;
        }
    }

    /**
     * Helper: delay for retry logic
     */
    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// SINGLETON INSTANCE
// ═══════════════════════════════════════════════════════════════════════════

/** Singleton service instance */
export const manychatFlowService = new ManyChatFlowService();

/** Export class for testing */
export { ManyChatFlowService };

export default manychatFlowService;
