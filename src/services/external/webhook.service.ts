/**
 * Webhook Service
 * 
 * Contains all business logic for processing ManyChat webhook requests.
 * Controllers should call this service - no business logic in controllers.
 * 
 * Responsibilities:
 * - Load user state from DB
 * - Detect intent using IntentClassifier
 * - Validate state transitions using FSM
 * - Enforce rate limits
 * - Queue async jobs
 * - Coordinate ManyChat flow triggers
 * 
 * @author ScriptFlow Team
 * @version 3.0.0
 */

import crypto from 'crypto';
import { logger } from '../../utils/logger';

// FSM & Intent Classifier
import {
    chatbotFSM,
    ChatbotState,
    ChatbotEvent,
    FSMTransitionError,
    TransitionResult
} from '../chatbot/chatbotStateMachine.service';
import {
    intentClassifier,
    UserIntent,
    ClassificationResult,
    extractReelUrl,
    isIntentValidForState,
    getValidStatesForIntent
} from '../chatbot/intentClassifier.service';

// Rate Limiting
import { getUserRateLimitStatus, isUserBlocked } from '../../middleware/userRateLimiter';

// Queue
import { addScriptJob, ScriptJobData } from '../../queue';
import { getRedis } from '../../queue/redis';

// Database
import { Job, UserMemory } from '../../db/models';
import { ReelDNA } from '../../db/models/ReelDNA';

// Services
import { manychatFlowService, ManyChatFlow } from './manychatFlow.service';
import { manychatStateService } from './manychatState.service';
import { loopPrevention } from '../chatbot/loopPrevention.service';
import { normalizeInstagramUrl, generateRequestHashV2, generateReelHash } from '../../utils/hash';
import { requestCoalescer } from '../requestCoalescer';
import { extractPatternDNA, buildPatternMandate } from '../ai/patternExtractor.service';
import { classifyFirstReelIntent, FirstReelIntent } from '../chatbot/firstReelIntentClassifier.service';

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Webhook request input (from controller)
 */
export interface WebhookRequest {
    subscriberId: string;
    rawMessage: string;
    reelUrl?: string;
    toneHint?: string;
    languageHint?: string;
    mode?: 'full' | 'hook_only';
    requestId?: string;
    /** Source of the message (for loop detection) */
    source?: string;
    /** Additional metadata from ManyChat */
    metadata?: Record<string, unknown>;
    /** Storytelling format for post-delivery restyling */
    storyFormat?: 'story' | 'edgy' | 'tutorial';
}

/**
 * Webhook processing result
 */
export interface WebhookResult {
    success: boolean;
    action: 'queued' | 'cached' | 'prompted' | 'error' | 'rate_limited' | 'blocked' | 'invalid_transition' | 'ignored';
    message: string;
    data?: {
        jobId?: string;
        intent?: UserIntent;
        state?: ChatbotState;
        previousState?: ChatbotState;
        validEvents?: ChatbotEvent[];
        reelUrl?: string;
        userIdea?: string;
        rateLimit?: {
            remaining: number;
            limit: number;
            resetInSeconds: number;
        };
        error?: {
            code: string;
            details?: string;
        };
    };
}

/**
 * Intent to FSM event mapping
 */
const INTENT_TO_EVENT: Record<UserIntent, ChatbotEvent | null> = {
    [UserIntent.NEW_REEL]: ChatbotEvent.SUBMIT_REEL,
    [UserIntent.SUBMIT_IDEA]: ChatbotEvent.SUBMIT_IDEA,
    [UserIntent.VARIATION]: ChatbotEvent.REQUEST_REDO,
    [UserIntent.REMIX]: ChatbotEvent.REQUEST_REDO, // NEW: Remix uses same transition as variation
    [UserIntent.COPY]: null, // COPY doesn't require state transition, just action
    [UserIntent.EXTRACT_ORIGINAL]: null, // EXTRACT doesn't require state transition, queues job
    [UserIntent.HELP]: null, // HELP doesn't require state transition, just send welcome
    [UserIntent.INVALID]: null,
};

// ═══════════════════════════════════════════════════════════════════════════
// WEBHOOK SERVICE CLASS
// ═══════════════════════════════════════════════════════════════════════════

/**
 * WebhookService - Main service for processing ManyChat webhooks.
 * 
 * This service orchestrates:
 * 1. User state loading
 * 2. Intent detection
 * 3. State transition validation
 * 4. Rate limit enforcement
 * 5. Job queuing
 * 6. ManyChat flow triggering
 * 
 * NO BUSINESS LOGIC IN CONTROLLERS - all logic lives here.
 */
class WebhookService {

    // ─────────────────────────────────────────────────────────────────────────
    // MAIN ENTRY POINT
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Process a webhook request from ManyChat.
     * This is the main entry point for all webhook processing.
     * 
     * @param request - The webhook request data
     * @returns WebhookResult with action taken and relevant data
     */
    async processWebhook(request: WebhookRequest): Promise<WebhookResult> {
        const requestId = request.requestId || crypto.randomUUID();
        const { subscriberId, rawMessage } = request;

        logger.info(`[Webhook:${requestId}] Processing request`, {
            subscriberId,
            messageLength: rawMessage.length,
        });

        try {
            // ───────────────────────────────────────────────────────────────────────
            // STEP 0: Loop Prevention - Detect and ignore system/automated messages
            // ───────────────────────────────────────────────────────────────────────
            const loopCheck = await loopPrevention.checkForLoop({
                subscriberId,
                rawMessage,
                source: request.source,
                requestId,
                metadata: request.metadata,
            });

            if (!loopCheck.shouldProcess) {
                logger.info(`[Webhook:${requestId}] Message ignored due to loop detection`, {
                    subscriberId,
                    loopType: loopCheck.loopType,
                    reason: loopCheck.reason,
                });

                return {
                    success: true, // Not an error, just ignored
                    action: 'ignored',
                    message: loopCheck.reason || 'Message ignored due to loop prevention',
                    data: {
                        error: {
                            code: `LOOP_${loopCheck.loopType?.toUpperCase() || 'DETECTED'}`,
                            details: loopCheck.reason,
                        }
                    }
                };
            }

            // ───────────────────────────────────────────────────────────────────────
            // STEP 1: Check if user is blocked
            // ───────────────────────────────────────────────────────────────────────
            const blocked = await isUserBlocked(subscriberId);
            if (blocked) {
                logger.warn(`[Webhook:${requestId}] Blocked user attempted access`, { subscriberId });

                await manychatFlowService.triggerFlow(subscriberId, ManyChatFlow.BLOCKED_USER);

                return {
                    success: false,
                    action: 'blocked',
                    message: 'Your access has been temporarily suspended.',
                    data: {
                        error: { code: 'USER_BLOCKED' }
                    }
                };
            }

            // ───────────────────────────────────────────────────────────────────────
            // STEP 2: Check rate limits
            // Per spec RATE LIMIT RULE: Set sc_status = BUSY (never send messages)
            // ───────────────────────────────────────────────────────────────────────
            const rateLimitStatus = await getUserRateLimitStatus(subscriberId);

            if (rateLimitStatus && rateLimitStatus.remaining <= 0) {
                logger.warn(`[Webhook:${requestId}] Rate limit exceeded`, {
                    subscriberId,
                    used: rateLimitStatus.used,
                    limit: rateLimitStatus.limit
                });

                // SPEC: Set sc_status = BUSY, sc_prompt_message = wait message
                // Backend NEVER sends Instagram messages - only updates fields
                await manychatStateService.setBusyState(subscriberId, rateLimitStatus.resetInSeconds);

                return {
                    success: false,
                    action: 'rate_limited',
                    message: `You've used all ${rateLimitStatus.limit} scripts this hour.`,
                    data: {
                        rateLimit: {
                            remaining: 0,
                            limit: rateLimitStatus.limit,
                            resetInSeconds: rateLimitStatus.resetInSeconds,
                        },
                        error: { code: 'RATE_LIMIT_EXCEEDED' }
                    }
                };
            }

            // ───────────────────────────────────────────────────────────────────────
            // STEP 3: Load user state from FSM
            // ───────────────────────────────────────────────────────────────────────
            const userState = await chatbotFSM.getCurrentState(subscriberId);

            logger.debug(`[Webhook:${requestId}] User state loaded`, {
                subscriberId,
                state: userState
            });

            // ───────────────────────────────────────────────────────────────────────
            // STEP 3.5: Handle FORMAT_RESTYLE (storytelling format restyling)
            // This is a special case where user clicked a format button in ManyChat
            // ───────────────────────────────────────────────────────────────────────
            if (rawMessage.toUpperCase() === 'FORMAT_RESTYLE' && request.storyFormat) {
                return this.handleFormatRestyle(requestId, request, userState, rateLimitStatus);
            }

            // ───────────────────────────────────────────────────────────────────────
            // STEP 4: Detect intent
            // ───────────────────────────────────────────────────────────────────────
            let classification = intentClassifier.classify(rawMessage, userState);

            // SPECIAL CASE: Explicit reel_url argument from ManyChat
            // If the request contains a reel_url but classification didn't pick it up (because it wasn't in rawMessage),
            // we forcefully override the intent to NEW_REEL.
            if (request.reelUrl && classification.intent !== UserIntent.NEW_REEL) {
                const intent = UserIntent.NEW_REEL;
                const validForState = isIntentValidForState(intent, userState);

                logger.info(`[Webhook:${requestId}] Explicit reel_url found, overriding intent to NEW_REEL`, {
                    reelUrl: request.reelUrl
                });

                classification = {
                    intent,
                    reason: 'Explicit reel_url provided in request',
                    extractedData: {
                        reelUrl: request.reelUrl,
                        normalizedMessage: classification.extractedData.normalizedMessage,
                        userIdea: classification.extractedData.userIdea
                            || (rawMessage.trim().length > 0 ? rawMessage.trim() : undefined)
                    },
                    matchedRule: 'EXPLICIT_REEL_URL',
                    validForState,
                    validInStates: validForState ? undefined : getValidStatesForIntent(intent),
                };
            }

            logger.info(`[Webhook:${requestId}] Intent classified`, {
                subscriberId,
                intent: classification.intent,
                matchedRule: classification.matchedRule,
                validForState: classification.validForState,
            });

            // ───────────────────────────────────────────────────────────────────────
            // STEP 5: Route based on intent
            // ───────────────────────────────────────────────────────────────────────
            switch (classification.intent) {
                case UserIntent.NEW_REEL:
                    return this.handleNewReel(requestId, request, classification, userState, rateLimitStatus);

                case UserIntent.SUBMIT_IDEA:
                    return this.handleSubmitIdea(requestId, request, classification, userState, rateLimitStatus);

                case UserIntent.VARIATION:
                    return this.handleVariation(requestId, request, classification, userState, rateLimitStatus);

                case UserIntent.REMIX:
                    return this.handleRemix(requestId, request, classification, userState, rateLimitStatus);

                case UserIntent.COPY:
                    return this.handleCopy(requestId, request, classification, userState);

                case UserIntent.EXTRACT_ORIGINAL:
                    return this.handleExtractOriginal(requestId, request, classification, userState, rateLimitStatus);

                case UserIntent.HELP:
                    return this.handleHelp(requestId, request, classification, userState);

                case UserIntent.INVALID:
                default:
                    return this.handleInvalidIntent(requestId, request, classification, userState);
            }

        } catch (error) {
            logger.error(`[Webhook:${requestId}] Unexpected error`, { subscriberId, error });

            await manychatFlowService.triggerFlow(subscriberId, ManyChatFlow.ERROR, {
                errorMessage: 'Something went wrong. Please try again!',
            });

            return {
                success: false,
                action: 'error',
                message: 'An unexpected error occurred.',
                data: {
                    error: {
                        code: 'INTERNAL_ERROR',
                        details: error instanceof Error ? error.message : 'Unknown error'
                    }
                }
            };
        }
    }

    // ─────────────────────────────────────────────────────────────────────────
    // INTENT HANDLERS
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Handle NEW_REEL intent - user is submitting a new reel URL
     */
    private async handleNewReel(
        requestId: string,
        request: WebhookRequest,
        classification: ClassificationResult,
        currentState: ChatbotState,
        rateLimitStatus: any
    ): Promise<WebhookResult> {
        const { subscriberId, rawMessage, toneHint, languageHint, mode } = request;
        const reelUrl = classification.extractedData.reelUrl || request.reelUrl;

        if (!reelUrl) {
            logger.warn(`[Webhook:${requestId}] NEW_REEL intent but no URL extracted`);
            return this.handleInvalidIntent(requestId, request, classification, currentState);
        }

        // Validate state transition
        const event = ChatbotEvent.SUBMIT_REEL;
        const transitionResult = await chatbotFSM.transition(subscriberId, event, {
            reelUrl,
            requestId,
        });

        if (!transitionResult.success) {
            return this.handleInvalidTransition(requestId, subscriberId, transitionResult, classification);
        }

        // Normalize and process
        const normalizedUrl = normalizeInstagramUrl(reelUrl);

        // Check if message contains additional context (idea)
        // Priority: 1. Extracted by classifier (ENHANCED with smart cleaning), 2. Fallback to manual extraction
        let userIdea = classification.extractedData.userIdea;

        if (!userIdea) {
            // Fallback: Manual extraction (backward compatibility)
            // Remove the reel URL and any trailing query parameters
            let messageWithoutUrl = rawMessage.replace(reelUrl, '').trim();

            // Remove leftover URL fragments like ?igsh=abc123 or /?igsh=...
            messageWithoutUrl = messageWithoutUrl
                .replace(/^\/?[?&][a-zA-Z0-9_]+=[a-zA-Z0-9_%-]*/g, '')
                .trim();

            // Only use as idea if it's meaningful text (not URL garbage)
            if (messageWithoutUrl.length > 3 && !/^[?&/=%]/.test(messageWithoutUrl)) {
                userIdea = messageWithoutUrl;
                logger.debug(`[Webhook:${requestId}] Fallback idea extraction: "${userIdea}"`);
            }
        } else {
            logger.info(`[Webhook:${requestId}] Classifier extracted idea: "${userIdea}"`);
        }

        if (userIdea) {
            // ═════════════════════════════════════════════════════════════════════════
            // FIRST REEL INTENT CLASSIFICATION - Determine if user wants to transform
            // the original reel or create a completely new script
            // ═════════════════════════════════════════════════════════════════════════

            const firstReelIntent = classifyFirstReelIntent(rawMessage);

            logger.info(`[Webhook:${requestId}] First reel intent classified`, {
                intent: firstReelIntent.intent,
                confidence: firstReelIntent.confidence,
                reasoning: firstReelIntent.reasoning,
                extractedIdea: firstReelIntent.extractedIdea,
            });

            // Store base mode in metadata for future remix operations
            await chatbotFSM.updateMetadata(subscriberId, {
                baseMode: firstReelIntent.intent, // TRANSFORM_ORIGINAL or CREATE_NEW
            });

            // ─────────────────────────────────────────────────────────────────────────
            // SCENARIO C: Check if userIdea is "Extract" (case insensitive)
            // This triggers transcript extraction without creative rewriting
            // ─────────────────────────────────────────────────────────────────────────
            const normalizedIdea = userIdea.toLowerCase().trim();
            const isExtractMode = normalizedIdea === 'extract' ||
                normalizedIdea === 'transcript' ||
                normalizedIdea === 'original';

            if (isExtractMode) {
                logger.info(`[Webhook:${requestId}] EXTRACT MODE detected - will transcribe without rewriting`);
                return this.queueScriptJob(requestId, {
                    subscriberId,
                    reelUrl: normalizedUrl,
                    userIdea: '[EXTRACT ORIGINAL TRANSCRIPT]',
                    toneHint,
                    languageHint,
                    mode,
                    isVariation: false,
                    variationIndex: 0,
                    isCopyMode: true, // Enables transcript extraction only
                }, transitionResult.newState, rateLimitStatus);
            }

            // ─────────────────────────────────────────────────────────────────────────
            // SCENARIO A: Combined - user provided reel + idea (creative rewriting)
            // ─────────────────────────────────────────────────────────────────────────
            logger.info(`[Webhook:${requestId}] Queueing job with reel + idea (single-message flow)`, {
                baseMode: firstReelIntent.intent,
            });

            return this.queueScriptJob(requestId, {
                subscriberId,
                reelUrl: normalizedUrl,
                userIdea,
                toneHint,
                languageHint,
                mode,
                isVariation: false,
                variationIndex: 0,
            }, transitionResult.newState, rateLimitStatus);
        } else {
            // User provided reel only - store reel and prompt for idea
            await chatbotFSM.transition(subscriberId, ChatbotEvent.SUBMIT_IDEA); // Move to awaiting idea

            // CRITICAL: Store reel URL in metadata for two-message flow
            await chatbotFSM.updateMetadata(subscriberId, {
                reelUrl: normalizedUrl,
                userIdea: null, // Will be provided in next message
            });

            // Set ManyChat status to AwaitingIdea so automation can prompt user
            // NOTE: We ONLY set custom fields here (no message sending).
            // ManyChat Default Reply reads sc_status and sc_prompt_message to show prompt.
            // This avoids Meta 24-hour window errors (error 3011).
            await manychatStateService.setAwaitingIdeaState(subscriberId, normalizedUrl);

            logger.info(`[Webhook:${requestId}] Awaiting idea state set (pull-based, no API message)`, {
                subscriberId,
                reelUrl: normalizedUrl.substring(0, 50)
            });

            return {
                success: true,
                action: 'prompted',
                message: 'Prompted user for idea',
                data: {
                    intent: UserIntent.NEW_REEL,
                    state: ChatbotState.AWAITING_IDEA,
                    previousState: currentState,
                    reelUrl: normalizedUrl,
                }
            };
        }
    }

    /**
     * Handle SUBMIT_IDEA intent - user sent their idea after previously sending a reel
     * This handles the two-message flow: 1) reel link, 2) idea text
     */
    private async handleSubmitIdea(
        requestId: string,
        request: WebhookRequest,
        classification: ClassificationResult,
        currentState: ChatbotState,
        rateLimitStatus: any
    ): Promise<WebhookResult> {
        const { subscriberId, rawMessage, toneHint, languageHint, mode } = request;

        // Get the stored reel URL from FSM metadata
        const context = await chatbotFSM.getState(subscriberId);
        const storedReelUrl = context.metadata.reelUrl as string;

        if (!storedReelUrl) {
            // No stored reel URL - this shouldn't happen but handle gracefully
            logger.warn(`[Webhook:${requestId}] SUBMIT_IDEA but no stored reel URL`);

            await manychatFlowService.triggerFlow(subscriberId, ManyChatFlow.PROMPT_REEL);

            return {
                success: false,
                action: 'prompted',
                message: 'No reel URL found. Please send a reel first.',
                data: {
                    intent: UserIntent.SUBMIT_IDEA,
                    state: currentState,
                    error: { code: 'NO_STORED_REEL' }
                }
            };
        }

        // User's idea is the raw message (or extracted from classification)
        const userIdea = classification.extractedData.userIdea || rawMessage.trim();

        logger.info(`[Webhook:${requestId}] Processing SUBMIT_IDEA`, {
            subscriberId,
            storedReelUrl: storedReelUrl.substring(0, 50),
            userIdea: userIdea.substring(0, 50),
        });

        // ─────────────────────────────────────────────────────────────────────────
        // SCENARIO C: Check if userIdea is "Extract" (case insensitive)
        // This triggers transcript extraction without creative rewriting
        // ─────────────────────────────────────────────────────────────────────────
        const normalizedIdea = userIdea.toLowerCase().trim();
        const isExtractMode = normalizedIdea === 'extract' ||
            normalizedIdea === 'transcript' ||
            normalizedIdea === 'original';

        if (isExtractMode) {
            logger.info(`[Webhook:${requestId}] EXTRACT MODE detected in SUBMIT_IDEA flow`);
            return this.queueScriptJob(requestId, {
                subscriberId,
                reelUrl: storedReelUrl,
                userIdea: '[EXTRACT ORIGINAL TRANSCRIPT]',
                toneHint,
                languageHint,
                mode,
                isVariation: false,
                variationIndex: 0,
                isCopyMode: true, // Enables transcript extraction only
            }, currentState, rateLimitStatus);
        }

        // Queue the script job with stored reel + new idea (creative rewriting)
        return this.queueScriptJob(requestId, {
            subscriberId,
            reelUrl: storedReelUrl,
            userIdea,
            toneHint,
            languageHint,
            mode,
            isVariation: false,
            variationIndex: 0,
        }, currentState, rateLimitStatus);
    }

    /**
     * Handle VARIATION intent - user wants another version
     */
    private async handleVariation(
        requestId: string,
        request: WebhookRequest,
        classification: ClassificationResult,
        currentState: ChatbotState,
        rateLimitStatus: any
    ): Promise<WebhookResult> {
        const { subscriberId, toneHint, languageHint, mode } = request;

        // Validate state transition
        if (!classification.validForState) {
            const transitionResult: TransitionResult = {
                success: false,
                previousState: currentState,
                newState: currentState,
                event: ChatbotEvent.REQUEST_REDO,
                error: new FSMTransitionError(
                    subscriberId,
                    currentState,
                    ChatbotEvent.REQUEST_REDO,
                    classification.validInStates ? [] : chatbotFSM.getValidEventsForState(currentState)
                ),
                context: await chatbotFSM.getState(subscriberId),
            };

            return this.handleInvalidTransition(requestId, subscriberId, transitionResult, classification);
        }

        // Transition to REDO_REQUESTED
        const transitionResult = await chatbotFSM.transition(subscriberId, ChatbotEvent.REQUEST_REDO);

        if (!transitionResult.success) {
            return this.handleInvalidTransition(requestId, subscriberId, transitionResult, classification);
        }

        // Get stored context from FSM metadata
        const context = transitionResult.context;
        const lastReelUrl = context.metadata.reelUrl as string;
        const lastUserIdea = context.metadata.userIdea as string;
        const variationCount = (context.metadata.variationCount as number || 0) + 1;

        if (!lastReelUrl) {
            // No previous reel - prompt user
            await manychatFlowService.triggerFlow(subscriberId, ManyChatFlow.NO_PREVIOUS_REEL);

            return {
                success: false,
                action: 'prompted',
                message: 'No previous reel found. Please send a reel first.',
                data: {
                    intent: UserIntent.VARIATION,
                    state: transitionResult.newState,
                    error: { code: 'NO_PREVIOUS_REEL' }
                }
            };
        }

        // Update variation count in context
        await chatbotFSM.updateMetadata(subscriberId, { variationCount });

        // Queue variation job
        return this.queueScriptJob(requestId, {
            subscriberId,
            reelUrl: lastReelUrl,
            userIdea: lastUserIdea || 'Generate a fresh script',
            toneHint,
            languageHint,
            mode,
            isVariation: true,
            variationIndex: variationCount,
        }, transitionResult.newState, rateLimitStatus);
    }

    /**
     * Handle REMIX intent - user wants to transform the script (shorter, longer, funnier, etc.)
     * Different from VARIATION: Remix applies a specific transformation, variation creates a new version
     */
    private async handleRemix(
        requestId: string,
        request: WebhookRequest,
        classification: ClassificationResult,
        currentState: ChatbotState,
        rateLimitStatus: any
    ): Promise<WebhookResult> {
        const { subscriberId, toneHint, languageHint, mode } = request;

        // Get remix type from classification (e.g., 'shorter', 'funnier', 'edgy')
        const remixType = classification.extractedData.userIdea || 'remix';

        // Build remix instruction based on type
        const remixInstructions: Record<string, string> = {
            'shorter': 'Make it MUCH shorter and punchier. Cut to 15-20 seconds. Remove all filler. Keep only the most impactful points.',
            'longer': 'Expand with more detail and depth. Add a third insight. Include more examples. Target 40-50 seconds.',
            'brief': 'Make it MUCH shorter and punchier. Cut to 15-20 seconds. Remove all filler.',
            'detailed': 'Add more depth, examples, and explanations. Expand each point with supporting details.',
            'funnier': 'Add humor! Include witty observations, unexpected twists, or self-deprecating jokes. Make it entertaining.',
            'serious': 'Make it more professional and authoritative. Remove casual language. Add credibility markers.',
            'casual': 'Make it ultra-casual and friendly. Use slang, contractions, and speak like texting a friend.',
            'professional': 'Use business/corporate tone. Add data points and professional terminology. Sound like an expert.',
            'edgy': 'Make it bold and provocative! Add controversial takes, strong opinions, and pattern-breaking statements.',
            'friendly': 'Make it warm and approachable. Use inclusive language and conversational tone.',
            'simpler': 'Simplify everything. Use shorter words, simpler concepts. Make it accessible to anyone.',
            'punchy': 'Make every sentence hit hard. Short. Impactful. No wasted words.',
            'snappy': 'Quick cuts, fast pacing. Lots of energy in the delivery.',
            'dramatic': 'Add drama! Build tension, use pauses, create emotional peaks.',
            'engaging': 'Add more hooks, questions, and calls-to-action. Make viewers want to interact.',
            'remix': 'Create a fresh version with a different angle or approach. Keep the same topic but change the perspective.',
        };

        const remixInstruction = remixInstructions[remixType] || remixInstructions['remix'];

        logger.info(`[Webhook:${requestId}] REMIX request: type=${remixType}`, { subscriberId, remixType, remixInstruction });

        // Validate state transition (same as variation)
        if (!classification.validForState) {
            const transitionResult: TransitionResult = {
                success: false,
                previousState: currentState,
                newState: currentState,
                event: ChatbotEvent.REQUEST_REDO,
                error: new FSMTransitionError(
                    subscriberId,
                    currentState,
                    ChatbotEvent.REQUEST_REDO,
                    classification.validInStates ? [] : chatbotFSM.getValidEventsForState(currentState)
                ),
                context: await chatbotFSM.getState(subscriberId),
            };

            return this.handleInvalidTransition(requestId, subscriberId, transitionResult, classification);
        }

        // Transition to REDO_REQUESTED
        const transitionResult = await chatbotFSM.transition(subscriberId, ChatbotEvent.REQUEST_REDO);

        if (!transitionResult.success) {
            return this.handleInvalidTransition(requestId, subscriberId, transitionResult, classification);
        }

        // Get stored context from FSM metadata
        const context = transitionResult.context;
        const lastReelUrl = context.metadata.reelUrl as string;
        const lastUserIdea = context.metadata.userIdea as string;

        if (!lastReelUrl) {
            // No previous reel - prompt user
            await manychatFlowService.triggerFlow(subscriberId, ManyChatFlow.NO_PREVIOUS_REEL);

            return {
                success: false,
                action: 'prompted',
                message: 'No previous reel found. Please send a reel first.',
                data: {
                    intent: UserIntent.REMIX,
                    state: transitionResult.newState,
                    error: { code: 'NO_PREVIOUS_REEL' }
                }
            };
        }

        // ═════════════════════════════════════════════════════════════════════════
        // PATTERN DNA INTEGRATION - Load appropriate pattern DNA based on base mode
        // ═════════════════════════════════════════════════════════════════════════

        let patternMandate = '';

        try {
            // Load pattern DNA from cache
            const reelHash = generateReelHash(lastReelUrl);
            const cachedDNA = await ReelDNA.findOne({ reelUrlHash: reelHash }).lean();

            // Determine which pattern DNA to use based on user's original intent
            const baseMode = context.metadata.baseMode as FirstReelIntent | undefined;
            const useOriginalDNA = baseMode === FirstReelIntent.TRANSFORM_ORIGINAL ||
                baseMode === FirstReelIntent.ENHANCE_ORIGINAL;

            if (cachedDNA) {
                const selectedDNA = useOriginalDNA ? cachedDNA.originalPatternDNA : cachedDNA.patternDNA;

                if (selectedDNA) {
                    const dnaType = useOriginalDNA ? 'ORIGINAL (creator\'s style)' : 'GENERATED (our style)';

                    logger.info(`[Webhook:${requestId}] Pattern DNA found for remix`, {
                        dnaType,
                        baseMode,
                        hookArchetype: selectedDNA.hookArchetype,
                        pacing: selectedDNA.pacing,
                        visualStyle: selectedDNA.visualStyle,
                    });

                    // Build pattern preservation mandate
                    patternMandate = buildPatternMandate(selectedDNA, remixType);
                } else {
                    logger.info(`[Webhook:${requestId}] No ${useOriginalDNA ? 'original' : 'generated'} pattern DNA cached`, {
                        reelHash,
                        baseMode,
                        fallback: 'standard remix'
                    });
                }
            } else {
                logger.info(`[Webhook:${requestId}] No ReelDNA cache found - using standard remix`, { reelHash });
            }
        } catch (error) {
            logger.error(`[Webhook:${requestId}] Error loading pattern DNA - falling back to standard remix`, { error });
            // Graceful fallback - continue without pattern mandate
        }

        // Queue remix job with transformation instruction
        // Pattern mandate is prepended if available (preserves structure)
        const enhancedIdea = patternMandate
            ? `${patternMandate}\n\n[REMIX: ${remixType.toUpperCase()}] ${remixInstruction}\n\nOriginal idea: ${lastUserIdea || 'Same topic, new approach'}`
            : `[REMIX: ${remixType.toUpperCase()}] ${remixInstruction}\n\nOriginal idea: ${lastUserIdea || 'Same topic, new approach'}`;

        return this.queueScriptJob(requestId, {
            subscriberId,
            reelUrl: lastReelUrl,
            userIdea: enhancedIdea,
            toneHint,
            languageHint,
            mode,
            isVariation: true, // Use variation flow for job processing
            variationIndex: 1, // Mark as first remix attempt
        }, transitionResult.newState, rateLimitStatus);
    }

    /**
     * Handle COPY intent - user wants to copy the script
     */
    private async handleCopy(
        requestId: string,
        request: WebhookRequest,
        classification: ClassificationResult,
        currentState: ChatbotState
    ): Promise<WebhookResult> {
        const { subscriberId } = request;

        // Validate state for copy
        if (!classification.validForState) {
            await manychatFlowService.triggerFlow(subscriberId, ManyChatFlow.NOTHING_TO_COPY);

            return {
                success: false,
                action: 'error',
                message: 'No script available to copy. Generate a script first!',
                data: {
                    intent: UserIntent.COPY,
                    state: currentState,
                    validEvents: classification.validInStates ? undefined : chatbotFSM.getValidEventsForState(currentState),
                    error: { code: 'NOTHING_TO_COPY' }
                }
            };
        }

        // Get the last script URL from context
        const context = await chatbotFSM.getState(subscriberId);
        const scriptUrl = context.metadata.lastScriptUrl as string;
        const scriptId = context.metadata.lastScriptId as string;

        if (!scriptUrl && !scriptId) {
            await manychatFlowService.triggerFlow(subscriberId, ManyChatFlow.NOTHING_TO_COPY);

            return {
                success: false,
                action: 'error',
                message: 'No script available to copy.',
                data: {
                    intent: UserIntent.COPY,
                    state: currentState,
                    error: { code: 'NOTHING_TO_COPY' }
                }
            };
        }

        // Trigger copy flow with script URL
        await manychatFlowService.triggerFlow(subscriberId, ManyChatFlow.COPY_SCRIPT, {
            scriptUrl,
            scriptId,
        });

        return {
            success: true,
            action: 'queued', // Copy is instant but we return queued for consistency
            message: 'Copy link sent!',
            data: {
                intent: UserIntent.COPY,
                state: currentState,
            }
        };
    }

    /**
     * Handle HELP intent - user wants help or greeted the bot
     */
    private async handleHelp(
        requestId: string,
        request: WebhookRequest,
        classification: ClassificationResult,
        currentState: ChatbotState
    ): Promise<WebhookResult> {
        const { subscriberId } = request;

        logger.info(`[Webhook:${requestId}] Handling HELP intent`, {
            subscriberId,
            currentState,
        });

        // Send welcome/help message
        await manychatFlowService.triggerFlow(subscriberId, ManyChatFlow.WELCOME_HELP);

        return {
            success: true,
            action: 'prompted',
            message: 'Sent welcome message',
            data: {
                intent: UserIntent.HELP,
                state: currentState,
            }
        };
    }

    /**
     * Handle EXTRACT_ORIGINAL intent - user wants the exact transcript from the reel
     * This queues a copy job that extracts and formats the transcript
     */
    private async handleExtractOriginal(
        requestId: string,
        request: WebhookRequest,
        classification: ClassificationResult,
        currentState: ChatbotState,
        rateLimitStatus: any
    ): Promise<WebhookResult> {
        const { subscriberId, toneHint, languageHint, mode } = request;

        logger.info(`[Webhook:${requestId}] Handling EXTRACT_ORIGINAL intent`, {
            subscriberId,
            currentState,
        });

        // Validate state for extract
        if (!classification.validForState) {
            await manychatFlowService.triggerFlow(subscriberId, ManyChatFlow.ERROR, {
                errorMessage: 'You need to generate a script first before extracting the original. Send me a reel!'
            });

            return {
                success: false,
                action: 'error',
                message: 'No previous reel to extract from',
                data: {
                    intent: UserIntent.EXTRACT_ORIGINAL,
                    state: currentState,
                    error: { code: 'NO_REEL_TO_EXTRACT' }
                }
            };
        }

        // Get the stored reel URL from state
        const context = await chatbotFSM.getState(subscriberId);
        // Robust check: try 'reelUrl' (current session) first, then 'lastReelUrl' (historical)
        const lastReelUrl = (context.metadata.reelUrl || context.metadata.lastReelUrl) as string;

        if (!lastReelUrl) {
            await manychatFlowService.triggerFlow(subscriberId, ManyChatFlow.ERROR, {
                errorMessage: 'No reel found. Please send me a reel first!'
            });

            return {
                success: false,
                action: 'error',
                message: 'No stored reel URL',
                data: {
                    intent: UserIntent.EXTRACT_ORIGINAL,
                    state: currentState,
                    error: { code: 'NO_REEL_URL' }
                }
            };
        }

        // Queue extract job with isCopyMode=true
        // This tells the worker to extract transcript and format it as script
        return this.queueScriptJob(requestId, {
            subscriberId,
            reelUrl: lastReelUrl,
            userIdea: '[EXTRACT ORIGINAL TRANSCRIPT]', // Special marker
            toneHint,
            languageHint,
            mode,
            isVariation: false,
            variationIndex: 0,
            isCopyMode: true, // This enables transcript extraction
        }, currentState, rateLimitStatus);
    }

    /**
     * Handle INVALID intent - message doesn't match any pattern
     */
    private async handleInvalidIntent(
        requestId: string,
        request: WebhookRequest,
        classification: ClassificationResult,
        currentState: ChatbotState
    ): Promise<WebhookResult> {
        const { subscriberId } = request;

        logger.debug(`[Webhook:${requestId}] Invalid intent`, {
            subscriberId,
            reason: classification.reason,
            matchedRule: classification.matchedRule,
        });

        // PULL-BASED: We no longer send messages via API to avoid 24-hour window errors.
        // ManyChat Default Reply reads sc_status and sc_prompt_message to show appropriate help.
        // The fields were already set when the user entered this state.
        // 
        // If the user is AWAITING_IDEA, fields are already set - just log and return.
        // For other states, we TRY to send a message but don't fail if it doesn't work.
        if (currentState === ChatbotState.AWAITING_IDEA) {
            logger.debug(`[Webhook:${requestId}] Invalid intent in AWAITING_IDEA - fields already set`);
            // Fields already set by setAwaitingIdeaState, ManyChat will show prompt
        } else if (currentState === ChatbotState.IDLE) {
            // Try to send welcome, but don't fail if 24h window expired
            await manychatFlowService.triggerFlow(subscriberId, ManyChatFlow.WELCOME_HELP);
        } else if (currentState === ChatbotState.AWAITING_FEEDBACK) {
            await manychatFlowService.triggerFlow(subscriberId, ManyChatFlow.FEEDBACK_HELP);
        } else {
            await manychatFlowService.triggerFlow(subscriberId, ManyChatFlow.GENERIC_HELP, {
                currentState,
            });
        }

        return {
            success: false,
            action: 'prompted',
            message: 'Message did not match any intent. Prompted for help.',
            data: {
                intent: UserIntent.INVALID,
                state: currentState,
                error: {
                    code: 'INVALID_INTENT',
                    details: classification.reason
                }
            }
        };
    }

    /**
     * Handle invalid state transitions
     */
    private async handleInvalidTransition(
        requestId: string,
        subscriberId: string,
        transitionResult: TransitionResult,
        classification: ClassificationResult
    ): Promise<WebhookResult> {
        const error = transitionResult.error as FSMTransitionError;
        const currentState = transitionResult.previousState;

        // SPECIAL HANDLING: If user tries to do something while we are PROCESSING
        if (currentState === ChatbotState.PROCESSING) {
            logger.info(`[Webhook:${requestId}] Ignoring request during PROCESSING state`, {
                subscriberId,
                attemptedIntent: classification.intent
            });

            // Trigger a specific "I'm busy" flow or just let ManyChat show default "Thinking..."
            // For now, we'll send a friendly error flow but return success:true so user isn't alarmed
            await manychatFlowService.triggerFlow(subscriberId, ManyChatFlow.INVALID_ACTION, {
                currentState,
                attemptedAction: classification.intent,
                message: 'Hold on! I am still creating your script. Please wait a moment...',
            });

            return {
                success: true, // Treat as success (handled gracefully)
                action: 'ignored',
                message: 'Request ignored - processing in progress',
                data: {
                    intent: classification.intent,
                    state: currentState,
                    error: {
                        code: 'BUSY_PROCESSING',
                        details: 'System is busy processing previous request'
                    }
                }
            };
        }

        // Log at INFO level for expected cases (e.g., user double-clicked)
        logger.info(`[Webhook:${requestId}] Invalid state transition (handled gracefully)`, {
            subscriberId,
            currentState,
            attemptedIntent: classification.intent,
            validEvents: error?.validEvents,
        });

        // Trigger appropriate flow based on current state
        await manychatFlowService.triggerFlow(subscriberId, ManyChatFlow.INVALID_ACTION, {
            currentState,
            attemptedAction: classification.intent,
            message: error?.message || 'This action is not available right now.',
        });

        return {
            success: false,
            action: 'invalid_transition',
            message: error?.message || 'Invalid action for current state.',
            data: {
                intent: classification.intent,
                state: currentState,
                validEvents: error?.validEvents,
                error: {
                    code: 'INVALID_TRANSITION',
                    details: error?.message,
                }
            }
        };
    }

    // ─────────────────────────────────────────────────────────────────────────
    // FORMAT RESTYLE HANDLER
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Handle FORMAT_RESTYLE - user clicked a storytelling format button
     * Uses stored reel+idea from previous generation to restyle the script
     */
    private async handleFormatRestyle(
        requestId: string,
        request: WebhookRequest,
        currentState: ChatbotState,
        rateLimitStatus: any
    ): Promise<WebhookResult> {
        const { subscriberId, storyFormat, toneHint, languageHint, mode } = request;

        logger.info(`[Webhook:${requestId}] Processing FORMAT_RESTYLE`, {
            subscriberId,
            storyFormat,
        });

        // Get stored reel + idea from FSM metadata (from previous generation)
        const context = await chatbotFSM.getState(subscriberId);
        const storedReelUrl = (context.metadata.reelUrl || context.metadata.lastReelUrl) as string;
        const storedUserIdea = (context.metadata.userIdea || context.metadata.lastUserIdea) as string;

        if (!storedReelUrl || !storedUserIdea) {
            logger.warn(`[Webhook:${requestId}] FORMAT_RESTYLE but no stored reel/idea`, {
                subscriberId,
                hasReelUrl: !!storedReelUrl,
                hasUserIdea: !!storedUserIdea,
            });

            await manychatFlowService.triggerFlow(subscriberId, ManyChatFlow.ERROR, {
                errorMessage: 'No previous script found. Send a reel first!'
            });

            return {
                success: false,
                action: 'error',
                message: 'No previous script to restyle',
                data: {
                    state: currentState,
                    error: { code: 'NO_PREVIOUS_SCRIPT' }
                }
            };
        }

        // Get variation count for hash uniqueness
        const variationCount = (context.metadata.variationCount as number || 0) + 1;

        // Update variation count in metadata
        await chatbotFSM.updateMetadata(subscriberId, { variationCount });

        // Queue job with storytelling format
        return this.queueScriptJob(requestId, {
            subscriberId,
            reelUrl: storedReelUrl,
            userIdea: storedUserIdea,
            toneHint,
            languageHint,
            mode,
            isVariation: true,
            variationIndex: variationCount,
            storyFormat,
        }, currentState, rateLimitStatus);
    }

    // ─────────────────────────────────────────────────────────────────────────
    // JOB QUEUING
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Queue a script generation job
     */
    private async queueScriptJob(
        requestId: string,
        params: {
            subscriberId: string;
            reelUrl: string;
            userIdea: string;
            toneHint?: string;
            languageHint?: string;
            mode?: 'full' | 'hook_only';
            isVariation: boolean;
            variationIndex: number;
            isCopyMode?: boolean; // When true, extracts exact transcript instead of generating new script
            storyFormat?: 'story' | 'edgy' | 'tutorial'; // Storytelling format for restyling
        },
        newState: ChatbotState,
        rateLimitStatus: any
    ): Promise<WebhookResult> {
        const { subscriberId, reelUrl, userIdea, toneHint, languageHint, mode, isVariation, variationIndex, isCopyMode, storyFormat } = params;

        // Generate request hash
        const requestHash = generateRequestHashV2(
            subscriberId,
            reelUrl,
            userIdea,
            variationIndex,
            mode || 'full'
        );

        // ──────────────────────────────────────────────────────────────────
        // REQUEST COALESCING: Check if identical request is already processing
        // If so, add this user to waiting list instead of creating new job
        // ──────────────────────────────────────────────────────────────────
        const coalesceCheck = await requestCoalescer.checkCoalesce(requestHash, subscriberId);

        if (coalesceCheck.shouldCoalesce && coalesceCheck.existingJobId) {
            logger.info(`[Webhook:${requestId}] Request coalesced with existing job`, {
                subscriberId,
                existingJobId: coalesceCheck.existingJobId,
                position: coalesceCheck.position
            });

            // Set ManyChat status to Processing (user will get result via fan-out)
            // Note: initializeProcessing is a NO-OP for V2 flow, but we call it for consistency
            try {
                await manychatStateService.initializeProcessing(
                    subscriberId,
                    false,
                    coalesceCheck.position || 0
                );
            } catch (stateError: any) {
                logger.warn(`[Webhook:${requestId}] Failed to set coalesced processing state`);
            }

            return {
                success: true,
                action: 'queued',
                message: `Your script is being created! You're #${coalesceCheck.position} in line.`,
                data: {
                    jobId: coalesceCheck.existingJobId,
                    state: newState,
                }
            };
        }

        // Check for duplicate in-flight jobs (legacy check)
        const existingJob = await Job.findOne({
            requestHash,
            status: { $in: ['queued', 'processing'] }
        });

        if (existingJob) {
            logger.info(`[Webhook:${requestId}] Job already in queue`, {
                jobId: existingJob.jobId,
                subscriberId
            });

            return {
                success: true,
                action: 'queued',
                message: 'Your script is already being created!',
                data: {
                    jobId: existingJob.jobId,
                    state: newState,
                }
            };
        }

        // Create job record
        await Job.create({
            jobId: requestId,
            subscriberId,
            status: 'queued',
            reelUrl,
            userIdea,
            requestHash,
            attempts: 0
        });

        // Transition to processing state and store job context in metadata
        await chatbotFSM.transition(subscriberId, ChatbotEvent.START_PROCESSING, {
            reelUrl,
            userIdea,
            variationCount: variationIndex,
            jobId: requestId,
        });

        // CRITICAL: Store reelUrl and userIdea for later COPY/VARIATION intents
        await chatbotFSM.updateMetadata(subscriberId, {
            reelUrl,
            userIdea,
            lastJobId: requestId,
            variationCount: variationIndex,
        });

        // ──────────────────────────────────────────────────────────────────
        // PULL-BASED DELIVERY: Initialize ManyChat state
        // Sets sc_status = "Processing" and clears old sc_last_script/sc_last_image
        // This ensures a fresh slate for each new request
        // ──────────────────────────────────────────────────────────────────
        try {
            await manychatStateService.initializeProcessing(subscriberId);
            logger.info(`[Webhook:${requestId}] ManyChat state initialized to Processing`);
        } catch (stateError: any) {
            // Non-fatal - job will still process, but user won't see "Processing" status
            logger.warn(`[Webhook:${requestId}] Failed to initialize ManyChat state`, {
                error: stateError.message
            });
        }

        // Add to queue
        const jobData: ScriptJobData = {
            requestId,
            requestHash,
            subscriberId,
            reelUrl,
            userIdea,
            toneHint: toneHint as any,
            languageHint,
            mode: mode || 'full',
            isCopyMode, // When true, worker extracts transcript instead of generating
            storyFormat, // Storytelling format for restyling
        };

        await addScriptJob(jobData);

        // Register this job for coalescing (so future identical requests can join)
        await requestCoalescer.registerJob(requestHash, requestId, subscriberId);

        logger.info(`[Webhook:${requestId}] Job queued (coalesce-enabled)`, {
            subscriberId,
            reelUrl: reelUrl.substring(0, 50),
            isVariation,
            variationIndex,
            requestHash: requestHash.substring(0, 16),
        });

        // ──────────────────────────────────────────────────────────────────
        // INCREMENT RATE LIMITER - Only for successfully queued jobs
        // This ensures failed/ignored requests don't count against the user
        // ──────────────────────────────────────────────────────────────────
        try {
            const redis = getRedis();
            const rateLimitKey = `user_rl:${subscriberId}`;
            const count = await redis.incr(rateLimitKey);

            // Set expiry only on first increment (1 hour window)
            if (count === 1) {
                await redis.expire(rateLimitKey, 3600); // 1 hour
            }

            logger.debug(`[Webhook:${requestId}] Rate limit incremented`, {
                subscriberId,
                count,
                limit: 10,
                remaining: Math.max(0, 10 - count)
            });
        } catch (rateLimitError: any) {
            // Non-fatal - job is already queued
            logger.error(`[Webhook:${requestId}] Failed to increment rate limit`, {
                subscriberId,
                error: rateLimitError.message
            });
        }

        // Trigger acknowledgment flow
        await manychatFlowService.triggerFlow(subscriberId, ManyChatFlow.JOB_QUEUED, {
            isVariation,
            variationNumber: variationIndex + 1,
            remaining: rateLimitStatus ? Math.max(0, rateLimitStatus.remaining - 1) : undefined,
        });

        // Store last action to prevent loops
        await loopPrevention.setLastAction(
            subscriberId,
            isVariation ? 'QUEUE_VARIATION' : 'QUEUE_SCRIPT',
            loopPrevention.hashMessage(userIdea),
            'user',
            requestId
        );

        return {
            success: true,
            action: 'queued',
            message: isVariation
                ? `Creating version #${variationIndex + 1}!`
                : 'Creating your custom script!',
            data: {
                jobId: requestId,
                state: ChatbotState.PROCESSING,
                rateLimit: rateLimitStatus ? {
                    remaining: rateLimitStatus.remaining - 1,
                    limit: rateLimitStatus.limit,
                    resetInSeconds: rateLimitStatus.resetInSeconds,
                } : undefined,
            }
        };
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// SINGLETON INSTANCE
// ═══════════════════════════════════════════════════════════════════════════

/** Singleton webhook service instance */
export const webhookService = new WebhookService();

/** Export class for testing */
export { WebhookService };

export default webhookService;
