import axios from 'axios';
import { logger } from '../utils/logger';
import { config } from '../config';

// SECURITY: Request timeout to prevent hung connections
const API_TIMEOUT_MS = 30000;

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface ManyChatPayload {
  subscriber_id: string;
  field_name: string;
  field_value: string;
  message_tag?: string;
  scriptUrl?: string;  // Optional URL for copy-friendly script page
}

export interface CarouselCard {
  title: string;
  subtitle: string;
  imageUrl: string;
  actionUrl?: string;
  buttons?: Array<{
    type: 'url' | 'postback';
    caption: string;
    url?: string;
    payload?: string;
  }>;
}

export interface CarouselPayload {
  subscriberId: string;
  cards: CarouselCard[];
  copyUrl?: string;
  messageTag?: string;
}

export interface SendCarouselResult {
  success: boolean;
  method: 'carousel' | 'sequential' | 'single' | 'failed';
  error?: string;
}

// ═══════════════════════════════════════════════════════════════════════════
// TEXT MESSAGE SENDER (ScriptFlow 2.0)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Send a simple text message to a subscriber
 * Used for prompts, error messages, and acknowledgments
 */
export async function sendTextMessage(
  subscriberId: string,
  text: string,
  messageTag: string = 'NON_PROMOTIONAL_SUBSCRIPTION'
): Promise<boolean> {
  const apiKey = config.MANYCHAT_API_KEY;
  
  if (!apiKey) {
    logger.warn('Skipping text message send: No MANYCHAT_API_KEY');
    return false;
  }
  
  try {
    const sendContentUrl = 'https://api.manychat.com/fb/sending/sendContent';
    
    await axios.post(sendContentUrl, {
      subscriber_id: subscriberId,
      data: {
        version: "v2",
        content: {
          messages: [{
            type: "text",
            text: text
          }]
        }
      },
      message_tag: messageTag
    }, {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      timeout: API_TIMEOUT_MS
    });
    
    logger.info(`Text message sent to ${subscriberId}`);
    return true;
  } catch (error: any) {
    logger.error(`Failed to send text message to ${subscriberId}: ${error.message}`);
    return false;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// CAROUSEL SENDER (ScriptFlow 2.0)
// ═══════════════════════════════════════════════════════════════════════════

/**
 * Send carousel message via ManyChat Generic Template API
 * 
 * Fallback strategy:
 * 1. Try carousel (cards) → Best experience
 * 2. Try sequential images → Acceptable experience  
 * 3. Fall back to field update → Legacy experience
 * 
 * @param payload - Carousel configuration
 * @returns Result indicating which method was used
 */
export async function sendCarousel(payload: CarouselPayload): Promise<SendCarouselResult> {
  const apiKey = config.MANYCHAT_API_KEY;
  
  if (!apiKey) {
    logger.warn('Skipping carousel send: No MANYCHAT_API_KEY');
    return { success: false, method: 'failed', error: 'No API key' };
  }
  
  const subscriberIdInt = parseInt(payload.subscriberId, 10);
  if (isNaN(subscriberIdInt)) {
    logger.error(`Invalid subscriber_id: ${payload.subscriberId}`);
    return { success: false, method: 'failed', error: 'Invalid subscriber ID' };
  }
  
  const sendContentUrl = 'https://api.manychat.com/fb/sending/sendContent';
  const headers = { 
    'Authorization': `Bearer ${apiKey}`, 
    'Content-Type': 'application/json' 
  };
  
  // Strategy 1: Try carousel (cards)
  try {
    logger.info(`Attempting carousel send for ${payload.subscriberId}`);
    
    // Build carousel elements
    const elements = payload.cards.map(card => ({
      title: card.title,
      subtitle: card.subtitle,
      image_url: card.imageUrl,
      action_url: card.actionUrl,
      buttons: card.buttons?.map(btn => ({
        type: btn.type === 'url' ? 'web_url' : 'postback',
        title: btn.caption,
        url: btn.url,
        payload: btn.payload,
      })),
    }));
    
    await axios.post(sendContentUrl, {
      subscriber_id: payload.subscriberId,
      data: {
        version: "v2",
        content: {
          type: "cards",
          elements,
          image_aspect_ratio: "square"  // 1:1 for our carousel cards
        }
      },
      message_tag: payload.messageTag || "NON_PROMOTIONAL_SUBSCRIPTION"
    }, {
      headers,
      timeout: API_TIMEOUT_MS
    });
    
    logger.info(`Carousel sent successfully to ${payload.subscriberId}`);
    
    // Send copy link as follow-up
    if (payload.copyUrl) {
      await sendCopyLinkMessage(payload.subscriberId, payload.copyUrl, headers);
    }
    
    return { success: true, method: 'carousel' };
    
  } catch (carouselError: any) {
    logger.warn(`Carousel send failed, trying sequential: ${carouselError.message}`);
    
    // Strategy 2: Try sequential images
    try {
      for (const card of payload.cards) {
        await axios.post(sendContentUrl, {
          subscriber_id: payload.subscriberId,
          data: {
            version: "v2",
            content: {
              type: "image",
              url: card.imageUrl,
              action: { type: "open_url", url: card.actionUrl || card.imageUrl }
            }
          },
          message_tag: payload.messageTag || "NON_PROMOTIONAL_SUBSCRIPTION"
        }, {
          headers,
          timeout: API_TIMEOUT_MS
        });
        
        // Small delay between images to maintain order
        await new Promise(resolve => setTimeout(resolve, 300));
      }
      
      logger.info(`Sequential images sent to ${payload.subscriberId}`);
      
      // Send copy link
      if (payload.copyUrl) {
        await sendCopyLinkMessage(payload.subscriberId, payload.copyUrl, headers);
      }
      
      return { success: true, method: 'sequential' };
      
    } catch (sequentialError: any) {
      logger.error(`Sequential send also failed: ${sequentialError.message}`);
      return { 
        success: false, 
        method: 'failed', 
        error: `Carousel: ${carouselError.message}, Sequential: ${sequentialError.message}` 
      };
    }
  }
}

/**
 * Send copy link message
 */
async function sendCopyLinkMessage(
  subscriberId: string, 
  copyUrl: string, 
  headers: Record<string, string>
): Promise<void> {
  try {
    const sendContentUrl = 'https://api.manychat.com/fb/sending/sendContent';
    
    await axios.post(sendContentUrl, {
      subscriber_id: subscriberId,
      data: {
        version: "v2",
        content: {
          messages: [{ 
            type: "text", 
            text: `📋 Tap to copy your script:\n${copyUrl}` 
          }]
        }
      },
      message_tag: "NON_PROMOTIONAL_SUBSCRIPTION"
    }, {
      headers,
      timeout: API_TIMEOUT_MS
    });
    
    logger.info(`Copy link sent to ${subscriberId}`);
  } catch (error: any) {
    logger.warn(`Failed to send copy link: ${error.message}`);
  }
}

/**
 * Build carousel cards from script images
 * Helper function for worker integration
 */
export function buildScriptCarouselCards(
  hookImageUrl: string,
  bodyImageUrl: string,
  ctaImageUrl: string,
  copyUrl: string
): CarouselCard[] {
  return [
    {
      title: '🎬 HOOK',
      subtitle: '0-3 seconds • Opening pattern interrupt',
      imageUrl: hookImageUrl,
      actionUrl: `${copyUrl}#hook`,
      buttons: [
        { type: 'url', caption: '📋 Copy Hook', url: `${copyUrl}#hook` }
      ]
    },
    {
      title: '📝 BODY',
      subtitle: '3-15 seconds • Main content delivery',
      imageUrl: bodyImageUrl,
      actionUrl: `${copyUrl}#body`,
      buttons: [
        { type: 'url', caption: '📋 Copy Body', url: `${copyUrl}#body` }
      ]
    },
    {
      title: '🎯 CTA',
      subtitle: '15-20 seconds • Call to action',
      imageUrl: ctaImageUrl,
      actionUrl: `${copyUrl}#cta`,
      buttons: [
        { type: 'url', caption: '📋 Copy CTA', url: `${copyUrl}#cta` }
      ]
    }
  ];
}

// ═══════════════════════════════════════════════════════════════════════════
// LEGACY SENDER (Backward Compatible)
// ═══════════════════════════════════════════════════════════════════════════

export async function sendToManyChat(payload: ManyChatPayload): Promise<void> {
  const apiKey = config.MANYCHAT_API_KEY;
  const enableDirect = config.MANYCHAT_ENABLE_DIRECT_MESSAGING === 'true';
  
  if (!apiKey) {
    logger.warn('Skipping ManyChat send: No MANYCHAT_API_KEY provided.');
    return;
  }

  const subscriberIdInt = parseInt(payload.subscriber_id, 10);
  
  if (isNaN(subscriberIdInt)) {
    logger.error(`Invalid subscriber_id: ${payload.subscriber_id}`);
    return;
  }

  try {
    logger.info(`Sending to ManyChat. Subscriber: ${payload.subscriber_id}`);

    // 1. Update Custom Fields
    const setFieldUrl = 'https://api.manychat.com/fb/subscriber/setCustomField';
    
    // [OPTIMIZATION] Update Copy URL Field FIRST
    // We do this before the image trigger so the link is ready when the automation starts.
    if (payload.scriptUrl && config.MANYCHAT_COPY_FIELD_ID) {
      await axios.post(setFieldUrl, {
        subscriber_id: subscriberIdInt,
        field_id: parseInt(config.MANYCHAT_COPY_FIELD_ID, 10),
        field_value: payload.scriptUrl
      }, {
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        timeout: API_TIMEOUT_MS
      });
      logger.info(`Updated script_copy_url field for ${payload.subscriber_id}`);
    }

    // Update Image URL Field (THE TRIGGER)
    // This is done LAST because it triggers the "Custom Field Changed" rule in ManyChat.
    const imageFieldId = config.MANYCHAT_SCRIPT_FIELD_ID || payload.field_name;
    if (imageFieldId) {
      await axios.post(setFieldUrl, {
        subscriber_id: subscriberIdInt,
        field_id: parseInt(imageFieldId, 10),
        field_value: payload.field_value
      }, {
        headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        timeout: API_TIMEOUT_MS
      });
    }

    // 2. Direct Messaging (CONTROLLABLE BY CONFIG)
    if (enableDirect && payload.field_name === 'script_image_url') {
      const sendContentUrl = 'https://api.manychat.com/fb/sending/sendContent';
      
      // Send Image
      try {
        await axios.post(sendContentUrl, {
          subscriber_id: payload.subscriber_id,
          data: {
            version: "v2",
            content: {
              type: "image",
              url: payload.field_value,
              action: { type: "open_url", url: payload.field_value }
            }
          },
          message_tag: "NON_PROMOTIONAL_SUBSCRIPTION"
        }, {
          headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
          timeout: API_TIMEOUT_MS
        });
      } catch (e: any) {
        logger.error(`Failed direct image send: ${e.message}`);
      }

      // Send Copy Link text
      if (payload.scriptUrl) {
        try {
          await axios.post(sendContentUrl, {
            subscriber_id: payload.subscriber_id,
            data: {
              version: "v2",
              content: {
                messages: [{ type: "text", text: `📋 Tap to copy script text:\n${payload.scriptUrl}` }]
              }
            },
            message_tag: "NON_PROMOTIONAL_SUBSCRIPTION"
          }, {
            headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
            timeout: API_TIMEOUT_MS
          });
        } catch (e: any) {
          logger.warn(`Failed direct link send: ${e.message}`);
        }
      }
    } else if (!enableDirect) {
      logger.info(`Direct messaging disabled. Relying on ManyChat field triggers for ${payload.subscriber_id}`);
    }

    logger.info(`Successfully completed ManyChat updates for user: ${payload.subscriber_id}`);

  } catch (error: any) {
    logger.error('Failed to send to ManyChat', JSON.stringify(error.response?.data || error.message, null, 2));
  }
}
