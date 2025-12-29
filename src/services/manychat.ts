import axios from 'axios';
import { logger } from '../utils/logger';
import { config } from '../config';

// SECURITY: Request timeout to prevent hung connections
const API_TIMEOUT_MS = 30000;

export interface ManyChatPayload {
  subscriber_id: string;
  field_name: string;
  field_value: string;
  message_tag?: string;
  scriptUrl?: string;  // Optional URL for copy-friendly script page
}

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
