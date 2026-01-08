/**
 * Chatbot Finite State Machine (FSM)
 * 
 * A deterministic finite state machine for managing chatbot conversation flow.
 * 
 * Features:
 * - Enum-based states for type safety
 * - Explicit transition validation (disallows invalid transitions)
 * - Redis-based state persistence per subscriber_id
 * - Detailed error messages for invalid transitions
 * 
 * @author ScriptFlow Team
 * @version 1.0.0
 */

import { logger } from '../../utils/logger';
import { getRedis } from '../../queue/redis';

// ═══════════════════════════════════════════════════════════════════════════
// STATE ENUM
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Chatbot conversation states as an enum for type safety.
 * Each state represents a distinct point in the conversation flow.
 */
export enum ChatbotState {
    /** Initial state - no conversation started */
    IDLE = 'IDLE',

    /** User has submitted a reel URL, awaiting their content idea */
    AWAITING_IDEA = 'AWAITING_IDEA',

    /** User has submitted idea, script is being generated */
    PROCESSING = 'PROCESSING',

    /** Script has been generated, awaiting user feedback */
    AWAITING_FEEDBACK = 'AWAITING_FEEDBACK',

    /** User requested a redo/variation of the script */
    REDO_REQUESTED = 'REDO_REQUESTED',

    /** An error occurred during processing */
    ERROR = 'ERROR',

    /** Conversation has been completed/closed */
    COMPLETED = 'COMPLETED',
}

// ═══════════════════════════════════════════════════════════════════════════
// TRANSITION EVENT ENUM
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Events that can trigger state transitions.
 * Each event represents a user action or system event.
 */
export enum ChatbotEvent {
    /** User submits a reel URL */
    SUBMIT_REEL = 'SUBMIT_REEL',

    /** User submits their content idea */
    SUBMIT_IDEA = 'SUBMIT_IDEA',

    /** Script generation has started */
    START_PROCESSING = 'START_PROCESSING',

    /** Script generation completed successfully */
    PROCESSING_COMPLETE = 'PROCESSING_COMPLETE',

    /** User requests a redo/variation */
    REQUEST_REDO = 'REQUEST_REDO',

    /** User provides feedback (positive or negative) */
    SUBMIT_FEEDBACK = 'SUBMIT_FEEDBACK',

    /** User cancels the conversation */
    CANCEL = 'CANCEL',

    /** User starts a new conversation */
    RESET = 'RESET',

    /** An error occurred */
    ERROR_OCCURRED = 'ERROR_OCCURRED',

    /** User confirms/completes the interaction */
    CONFIRM = 'CONFIRM',

    /** Session timeout occurred */
    TIMEOUT = 'TIMEOUT',
}

// ═══════════════════════════════════════════════════════════════════════════
// ERROR TYPES
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Error codes for FSM operations
 */
export enum FSMErrorCode {
    INVALID_TRANSITION = 'INVALID_TRANSITION',
    STATE_NOT_FOUND = 'STATE_NOT_FOUND',
    REDIS_ERROR = 'REDIS_ERROR',
    SUBSCRIBER_NOT_FOUND = 'SUBSCRIBER_NOT_FOUND',
    VALIDATION_ERROR = 'VALIDATION_ERROR',
}

/**
 * Custom error class for FSM transition errors
 */
export class FSMTransitionError extends Error {
    public readonly code: FSMErrorCode;
    public readonly currentState: ChatbotState;
    public readonly attemptedEvent: ChatbotEvent;
    public readonly validEvents: ChatbotEvent[];
    public readonly subscriberId: string;

    constructor(
        subscriberId: string,
        currentState: ChatbotState,
        attemptedEvent: ChatbotEvent,
        validEvents: ChatbotEvent[]
    ) {
        const message = `Invalid transition: Cannot trigger '${attemptedEvent}' from state '${currentState}'. ` +
            `Valid events from this state: [${validEvents.join(', ')}]`;

        super(message);
        this.name = 'FSMTransitionError';
        this.code = FSMErrorCode.INVALID_TRANSITION;
        this.currentState = currentState;
        this.attemptedEvent = attemptedEvent;
        this.validEvents = validEvents;
        this.subscriberId = subscriberId;

        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, FSMTransitionError);
        }
    }

    toJSON() {
        return {
            error: {
                code: this.code,
                message: this.message,
                currentState: this.currentState,
                attemptedEvent: this.attemptedEvent,
                validEvents: this.validEvents,
                subscriberId: this.subscriberId,
            }
        };
    }
}

/**
 * Custom error class for FSM persistence errors
 */
export class FSMPersistenceError extends Error {
    public readonly code: FSMErrorCode;
    public readonly subscriberId: string;
    public readonly operation: 'get' | 'set' | 'delete';

    constructor(
        subscriberId: string,
        operation: 'get' | 'set' | 'delete',
        originalError?: Error
    ) {
        const message = `Failed to ${operation} state for subscriber '${subscriberId}': ${originalError?.message || 'Unknown error'}`;

        super(message);
        this.name = 'FSMPersistenceError';
        this.code = FSMErrorCode.REDIS_ERROR;
        this.subscriberId = subscriberId;
        this.operation = operation;

        if (Error.captureStackTrace) {
            Error.captureStackTrace(this, FSMPersistenceError);
        }
    }

    toJSON() {
        return {
            error: {
                code: this.code,
                message: this.message,
                subscriberId: this.subscriberId,
                operation: this.operation,
            }
        };
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// STATE DATA INTERFACE
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Additional context stored alongside the state
 */
export interface FSMStateContext {
    currentState: ChatbotState;
    previousState: ChatbotState | null;
    lastEvent: ChatbotEvent | null;
    lastTransitionAt: string;
    createdAt: string;
    transitionCount: number;
    transitionHistory: Array<{
        from: ChatbotState;
        to: ChatbotState;
        event: ChatbotEvent;
        timestamp: string;
    }>;
    metadata: Record<string, unknown>;
}

// ═══════════════════════════════════════════════════════════════════════════
// TRANSITION RESULT INTERFACE
// ═══════════════════════════════════════════════════════════════════════════

export interface TransitionResult {
    success: boolean;
    previousState: ChatbotState;
    newState: ChatbotState;
    event: ChatbotEvent;
    error?: FSMTransitionError | FSMPersistenceError;
    context: FSMStateContext;
}

// ═══════════════════════════════════════════════════════════════════════════
// TRANSITION TABLE
// ═══════════════════════════════════════════════════════════════════════════

type TransitionEntry = {
    [event in ChatbotEvent]?: ChatbotState;
};

const TRANSITION_TABLE: Record<ChatbotState, TransitionEntry> = {
    [ChatbotState.IDLE]: {
        [ChatbotEvent.SUBMIT_REEL]: ChatbotState.AWAITING_IDEA,
        [ChatbotEvent.RESET]: ChatbotState.IDLE,
        [ChatbotEvent.TIMEOUT]: ChatbotState.IDLE,
    },

    [ChatbotState.AWAITING_IDEA]: {
        [ChatbotEvent.SUBMIT_IDEA]: ChatbotState.PROCESSING,
        [ChatbotEvent.SUBMIT_REEL]: ChatbotState.AWAITING_IDEA,
        [ChatbotEvent.START_PROCESSING]: ChatbotState.PROCESSING,
        [ChatbotEvent.CANCEL]: ChatbotState.IDLE,
        [ChatbotEvent.RESET]: ChatbotState.IDLE,
        [ChatbotEvent.TIMEOUT]: ChatbotState.IDLE,
        [ChatbotEvent.ERROR_OCCURRED]: ChatbotState.ERROR,
    },

    [ChatbotState.PROCESSING]: {
        [ChatbotEvent.PROCESSING_COMPLETE]: ChatbotState.AWAITING_FEEDBACK,
        [ChatbotEvent.ERROR_OCCURRED]: ChatbotState.ERROR,
        [ChatbotEvent.CANCEL]: ChatbotState.IDLE,
        [ChatbotEvent.TIMEOUT]: ChatbotState.ERROR,
    },

    [ChatbotState.AWAITING_FEEDBACK]: {
        [ChatbotEvent.SUBMIT_FEEDBACK]: ChatbotState.COMPLETED,
        [ChatbotEvent.REQUEST_REDO]: ChatbotState.REDO_REQUESTED,
        [ChatbotEvent.CONFIRM]: ChatbotState.COMPLETED,
        [ChatbotEvent.SUBMIT_REEL]: ChatbotState.AWAITING_IDEA,
        [ChatbotEvent.CANCEL]: ChatbotState.IDLE,
        [ChatbotEvent.RESET]: ChatbotState.IDLE,
        [ChatbotEvent.TIMEOUT]: ChatbotState.IDLE,
        [ChatbotEvent.ERROR_OCCURRED]: ChatbotState.ERROR,
    },

    [ChatbotState.REDO_REQUESTED]: {
        [ChatbotEvent.START_PROCESSING]: ChatbotState.PROCESSING,
        [ChatbotEvent.SUBMIT_IDEA]: ChatbotState.PROCESSING,
        [ChatbotEvent.CANCEL]: ChatbotState.IDLE,
        [ChatbotEvent.RESET]: ChatbotState.IDLE,
        [ChatbotEvent.ERROR_OCCURRED]: ChatbotState.ERROR,
        [ChatbotEvent.TIMEOUT]: ChatbotState.IDLE,
    },

    [ChatbotState.ERROR]: {
        [ChatbotEvent.RESET]: ChatbotState.IDLE,
        [ChatbotEvent.SUBMIT_REEL]: ChatbotState.AWAITING_IDEA,
        [ChatbotEvent.TIMEOUT]: ChatbotState.IDLE,
    },

    [ChatbotState.COMPLETED]: {
        [ChatbotEvent.RESET]: ChatbotState.IDLE,
        [ChatbotEvent.SUBMIT_REEL]: ChatbotState.AWAITING_IDEA,
        [ChatbotEvent.TIMEOUT]: ChatbotState.IDLE,
    },
};

// ═══════════════════════════════════════════════════════════════════════════
// CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════

const FSM_KEY_PREFIX = 'fsm:state:';
const FSM_STATE_TTL_SECONDS = 60 * 60;
const MAX_TRANSITION_HISTORY = 10;

// ═══════════════════════════════════════════════════════════════════════════
// HELPER FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════

function getFSMKey(subscriberId: string): string {
    return `${FSM_KEY_PREFIX}${subscriberId}`;
}

function createInitialContext(): FSMStateContext {
    const now = new Date().toISOString();
    return {
        currentState: ChatbotState.IDLE,
        previousState: null,
        lastEvent: null,
        lastTransitionAt: now,
        createdAt: now,
        transitionCount: 0,
        transitionHistory: [],
        metadata: {},
    };
}

function getValidEvents(state: ChatbotState): ChatbotEvent[] {
    const transitions = TRANSITION_TABLE[state];
    return Object.keys(transitions) as ChatbotEvent[];
}

function isValidTransition(currentState: ChatbotState, event: ChatbotEvent): boolean {
    const transitions = TRANSITION_TABLE[currentState];
    return event in transitions;
}

function getTargetState(currentState: ChatbotState, event: ChatbotEvent): ChatbotState | null {
    const transitions = TRANSITION_TABLE[currentState];
    return transitions[event] ?? null;
}

// ═══════════════════════════════════════════════════════════════════════════
// STATE MACHINE CLASS
// ═══════════════════════════════════════════════════════════════════════════

class ChatbotStateMachine {

    async getState(subscriberId: string, retries = 3): Promise<FSMStateContext> {
        let lastError: Error | null = null;
        
        for (let attempt = 1; attempt <= retries; attempt++) {
            try {
                const redis = getRedis();
                const key = getFSMKey(subscriberId);

                const data = await redis.get(key);

                if (!data) {
                    logger.debug('[FSM] No state found, creating initial state', { subscriberId });
                    const initialContext = createInitialContext();
                    await this.persistState(subscriberId, initialContext);
                    return initialContext;
                }

                const context = JSON.parse(data) as FSMStateContext;

                logger.debug('[FSM] State retrieved', {
                    subscriberId,
                    currentState: context.currentState,
                    transitionCount: context.transitionCount,
                });

                return context;
            } catch (error: any) {
                lastError = error;
                
                // Retry on connection errors
                if (attempt < retries && (error.message?.includes('ECONNRESET') || error.message?.includes('ETIMEDOUT'))) {
                    logger.warn(`[FSM] Retry ${attempt}/${retries} for getState`, { subscriberId, error: error.message });
                    await new Promise(resolve => setTimeout(resolve, 100 * attempt)); // Exponential backoff
                    continue;
                }
                
                logger.error('[FSM] Failed to get state', { subscriberId, error: error.message });
                throw new FSMPersistenceError(subscriberId, 'get', error);
            }
        }
        
        throw new FSMPersistenceError(subscriberId, 'get', lastError!);
    }

    async getCurrentState(subscriberId: string): Promise<ChatbotState> {
        const context = await this.getState(subscriberId);
        return context.currentState;
    }

    async transition(
        subscriberId: string,
        event: ChatbotEvent,
        metadata?: Record<string, unknown>
    ): Promise<TransitionResult> {
        try {
            const currentContext = await this.getState(subscriberId);
            const currentState = currentContext.currentState;

            if (!isValidTransition(currentState, event)) {
                const validEvents = getValidEvents(currentState);
                const error = new FSMTransitionError(
                    subscriberId,
                    currentState,
                    event,
                    validEvents
                );

                logger.warn('[FSM] Invalid transition attempted', {
                    subscriberId,
                    currentState,
                    event,
                    validEvents,
                });

                return {
                    success: false,
                    previousState: currentState,
                    newState: currentState,
                    event,
                    error,
                    context: currentContext,
                };
            }

            const targetState = getTargetState(currentState, event)!;
            const now = new Date().toISOString();

            const newTransition = {
                from: currentState,
                to: targetState,
                event,
                timestamp: now,
            };

            const newHistory = [
                newTransition,
                ...currentContext.transitionHistory,
            ].slice(0, MAX_TRANSITION_HISTORY);

            const newContext: FSMStateContext = {
                ...currentContext,
                currentState: targetState,
                previousState: currentState,
                lastEvent: event,
                lastTransitionAt: now,
                transitionCount: currentContext.transitionCount + 1,
                transitionHistory: newHistory,
                metadata: {
                    ...currentContext.metadata,
                    ...(metadata || {}),
                },
            };

            await this.persistState(subscriberId, newContext);

            logger.info('[FSM] State transition successful', {
                subscriberId,
                from: currentState,
                to: targetState,
                event,
                transitionCount: newContext.transitionCount,
            });

            return {
                success: true,
                previousState: currentState,
                newState: targetState,
                event,
                context: newContext,
            };
        } catch (error) {
            if (error instanceof FSMTransitionError || error instanceof FSMPersistenceError) {
                throw error;
            }

            logger.error('[FSM] Unexpected error during transition', { subscriberId, event, error });
            throw new FSMPersistenceError(subscriberId, 'set', error as Error);
        }
    }

    async canTransition(
        subscriberId: string,
        event: ChatbotEvent
    ): Promise<{
        valid: boolean;
        currentState: ChatbotState;
        targetState: ChatbotState | null;
        validEvents: ChatbotEvent[];
    }> {
        const context = await this.getState(subscriberId);
        const currentState = context.currentState;
        const valid = isValidTransition(currentState, event);
        const targetState = getTargetState(currentState, event);
        const validEvents = getValidEvents(currentState);

        return {
            valid,
            currentState,
            targetState,
            validEvents,
        };
    }

    async forceState(
        subscriberId: string,
        state: ChatbotState,
        reason: string
    ): Promise<FSMStateContext> {
        const currentContext = await this.getState(subscriberId);

        const now = new Date().toISOString();
        const newContext: FSMStateContext = {
            ...currentContext,
            currentState: state,
            previousState: currentContext.currentState,
            lastTransitionAt: now,
            transitionCount: currentContext.transitionCount + 1,
            transitionHistory: [
                {
                    from: currentContext.currentState,
                    to: state,
                    event: ChatbotEvent.RESET,
                    timestamp: now,
                },
                ...currentContext.transitionHistory,
            ].slice(0, MAX_TRANSITION_HISTORY),
            metadata: {
                ...currentContext.metadata,
                forceSetReason: reason,
                forceSetAt: now,
            },
        };

        await this.persistState(subscriberId, newContext);

        logger.warn('[FSM] State force-set', {
            subscriberId,
            from: currentContext.currentState,
            to: state,
            reason,
        });

        return newContext;
    }

    async reset(subscriberId: string): Promise<TransitionResult> {
        const result = await this.transition(subscriberId, ChatbotEvent.RESET);

        if (!result.success) {
            logger.warn('[FSM] RESET not valid from current state, forcing reset', {
                subscriberId,
                currentState: result.previousState,
            });

            const context = await this.forceState(subscriberId, ChatbotState.IDLE, 'Manual reset');
            return {
                success: true,
                previousState: result.previousState,
                newState: ChatbotState.IDLE,
                event: ChatbotEvent.RESET,
                context,
            };
        }

        return result;
    }

    async clearState(subscriberId: string): Promise<void> {
        try {
            const redis = getRedis();
            const key = getFSMKey(subscriberId);

            await redis.del(key);

            logger.info('[FSM] State cleared', { subscriberId });
        } catch (error) {
            logger.error('[FSM] Failed to clear state', { subscriberId, error });
            throw new FSMPersistenceError(subscriberId, 'delete', error as Error);
        }
    }

    async updateMetadata(
        subscriberId: string,
        metadata: Record<string, unknown>
    ): Promise<FSMStateContext> {
        const currentContext = await this.getState(subscriberId);

        const newContext: FSMStateContext = {
            ...currentContext,
            metadata: {
                ...currentContext.metadata,
                ...metadata,
            },
        };

        await this.persistState(subscriberId, newContext);

        logger.debug('[FSM] Metadata updated', {
            subscriberId,
            keys: Object.keys(metadata),
        });

        return newContext;
    }

    async getMetadata<T = unknown>(
        subscriberId: string,
        key: string
    ): Promise<T | undefined> {
        const context = await this.getState(subscriberId);
        return context.metadata[key] as T | undefined;
    }

    getValidEventsForState(state: ChatbotState): ChatbotEvent[] {
        return getValidEvents(state);
    }

    getTransitionTable(): Record<ChatbotState, TransitionEntry> {
        return { ...TRANSITION_TABLE };
    }

    async getStateInfo(subscriberId: string): Promise<{
        exists: boolean;
        ttlSeconds: number;
        context: FSMStateContext | null;
        validEvents: ChatbotEvent[];
    }> {
        try {
            const redis = getRedis();
            const key = getFSMKey(subscriberId);

            const [data, ttl] = await Promise.all([
                redis.get(key),
                redis.ttl(key),
            ]);

            if (!data) {
                return {
                    exists: false,
                    ttlSeconds: 0,
                    context: null,
                    validEvents: getValidEvents(ChatbotState.IDLE),
                };
            }

            const context = JSON.parse(data) as FSMStateContext;

            return {
                exists: true,
                ttlSeconds: ttl,
                context,
                validEvents: getValidEvents(context.currentState),
            };
        } catch (error) {
            logger.error('[FSM] Failed to get state info', { subscriberId, error });
            throw new FSMPersistenceError(subscriberId, 'get', error as Error);
        }
    }

    private async persistState(
        subscriberId: string,
        context: FSMStateContext,
        retries = 3
    ): Promise<void> {
        let lastError: Error | null = null;
        
        for (let attempt = 1; attempt <= retries; attempt++) {
            try {
                const redis = getRedis();
                const key = getFSMKey(subscriberId);

                await redis.setex(key, FSM_STATE_TTL_SECONDS, JSON.stringify(context));

                logger.debug('[FSM] State persisted', {
                    subscriberId,
                    state: context.currentState,
                });
                
                return; // Success
            } catch (error: any) {
                lastError = error;
                
                // Retry on connection errors
                if (attempt < retries && (error.message?.includes('ECONNRESET') || error.message?.includes('ETIMEDOUT') || error.message?.includes('ENOTFOUND'))) {
                    logger.warn(`[FSM] Retry ${attempt}/${retries} for persistState`, { subscriberId, error: error.message });
                    await new Promise(resolve => setTimeout(resolve, 100 * attempt)); // Exponential backoff
                    continue;
                }
                
                logger.error('[FSM] Failed to persist state', { subscriberId, error: error.message });
                throw new FSMPersistenceError(subscriberId, 'set', error);
            }
        }
        
        throw new FSMPersistenceError(subscriberId, 'set', lastError!);
    }
}

// ═══════════════════════════════════════════════════════════════════════════
// SINGLETON INSTANCE
// ═══════════════════════════════════════════════════════════════════════════

export const chatbotFSM = new ChatbotStateMachine();
export { ChatbotStateMachine };
export default chatbotFSM;
