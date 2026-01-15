import { cleanEnv, str, port, num } from 'envalid';
import dotenv from 'dotenv';
import path from 'path';
const ffmpegPath = require('ffmpeg-static');
const ffprobePath = require('ffprobe-static').path;

// Override system environment variables with .env file values
dotenv.config({ override: true });

export const config = cleanEnv(process.env, {
  // Server
  PORT: port({ default: 3000 }),
  NODE_ENV: str({ choices: ['development', 'test', 'production'], default: 'development' }),

  // Database
  MONGODB_URI: str({ desc: 'MongoDB connection string (Atlas or local)' }),

  // Redis (for BullMQ and rate limiting)
  REDIS_URL: str({ desc: 'Redis connection URL', default: 'redis://localhost:6379' }),

  // Queue
  QUEUE_CONCURRENCY: num({ desc: 'Number of concurrent job workers', default: 5 }),

  // Rate Limiting
  RATE_LIMIT_MAX: num({ desc: 'Max requests per 15min window (IP-based)', default: 100 }),
  USER_RATE_LIMIT: num({ desc: 'Max requests per hour per ManyChat user', default: 10 }),
  MAX_BETA_USERS: num({ desc: 'Max users with access (others go to waitlist)', default: 100 }),

  // AI Services (Vertex AI)
  GCP_PROJECT_ID: str({ desc: 'Google Cloud Project ID' }),
  GCP_LOCATION: str({ desc: 'Vertex AI region', default: 'us-central1' }),
  GOOGLE_APPLICATION_CREDENTIALS: str({ desc: 'Path to GCP service account JSON', default: '' }),

  // ManyChat
  MANYCHAT_API_KEY: str({ desc: 'API Key for ManyChat (Optional in dev)', default: '' }),
  MANYCHAT_CHANNEL: str({ choices: ['fb', 'ig'], desc: 'ManyChat channel: fb (default - works for both FB and Instagram)', default: 'fb' }),
  MANYCHAT_API_TOKEN: str({ desc: 'API Token for ManyChat (Bearer)', default: '' }),

  // Pull-based delivery model fields (avoids Meta 24-hour window restrictions)
  // Create Text-type custom fields in ManyChat and enter their IDs here
  // ManyChat automation reads these fields and displays content accordingly
  MANYCHAT_SC_STATUS_FIELD_ID: str({ desc: 'Field ID for sc_status (AwaitingIdea/Processing/Ready/Error)', default: '' }),
  MANYCHAT_SC_LAST_SCRIPT_FIELD_ID: str({ desc: 'Field ID for sc_last_script (text content)', default: '' }),
  MANYCHAT_SC_LAST_IMAGE_FIELD_ID: str({ desc: 'Field ID for sc_last_image (ImgBB URL)', default: '' }),
  MANYCHAT_SC_REEL_URL_FIELD_ID: str({ desc: 'Field ID for sc_reel_url (current reel being processed)', default: '' }),
  MANYCHAT_SC_PROMPT_MESSAGE_FIELD_ID: str({ desc: 'Field ID for sc_prompt_message (contextual user message)', default: '' }),
  MANYCHAT_SC_COPY_URL_FIELD_ID: str({ desc: 'Field ID for sc_copy_url (copy link for script)', default: '' }),
  MANYCHAT_SC_ERROR_CODE_FIELD_ID: str({ desc: 'Field ID for sc_error_code (error code for debugging)', default: '' }),

  // V2 Custom Fields (alternative field names)
  // These map to ManyChat custom fields by NAME: ai_generated_script, script_image, script_copy_link
  MANYCHAT_AI_GENERATED_SCRIPT_FIELD_ID: str({ desc: 'Field ID for ai_generated_script (script text)', default: '' }),
  MANYCHAT_SCRIPT_IMAGE_FIELD_ID: str({ desc: 'Field ID for script_image (single image URL)', default: '' }),
  MANYCHAT_SCRIPT_COPY_LINK_FIELD_ID: str({ desc: 'Field ID for script_copy_link (webpage URL)', default: '' }),

  // V2 Carousel Fields - Send 3 images (HOOK, BODY, CTA) as carousel
  MANYCHAT_CAROUSEL_HOOK_FIELD_ID: str({ desc: 'Field ID for carousel hook image', default: '' }),
  MANYCHAT_CAROUSEL_BODY_FIELD_ID: str({ desc: 'Field ID for carousel body image', default: '' }),
  MANYCHAT_CAROUSEL_CTA_FIELD_ID: str({ desc: 'Field ID for carousel CTA image', default: '' }),

  // V2 Carousel Array Field - Alternative: Send all 3 images in single array field
  // Create an Array-type custom field in ManyChat for this
  MANYCHAT_CAROUSEL_IMAGES_ARRAY_FIELD_ID: str({ desc: 'Field ID for carousel images array (ManyChat Array type)', default: '' }),


  // Image Services
  IMGBB_API_KEY: str({ desc: 'API Key for ImgBB', default: '' }),

  // Cloudinary Configuration (uses CLOUDINARY_URL format)
  // Format: cloudinary://API_KEY:API_SECRET@CLOUD_NAME
  CLOUDINARY_URL: str({ desc: 'Cloudinary URL (cloudinary://key:secret@cloud)', default: '' }),

  FFMPEG_PATH: str({ desc: 'Path to FFmpeg executable', default: ffmpegPath || '' }),
  FFPROBE_PATH: str({ desc: 'Path to FFprobe executable', default: ffprobePath || '' }),

  // Security (optional)
  ADMIN_API_KEY: str({ desc: 'API key for admin endpoints', default: '' }),

  // Public URLs
  BASE_URL: str({ desc: 'Base URL for public links (e.g., https://yourapp.onrender.com)', default: '' }),

  // Analysis
  ANALYSIS_MODE: str({ choices: ['audio', 'frames', 'hybrid'], default: 'hybrid' }),
  // AWS Configuration (for S3 and Hosting)
  AWS_REGION: str({ desc: 'AWS Region', default: 'ap-south-1' }),
  AWS_ACCESS_KEY_ID: str({ desc: 'AWS Access Key ID', default: '' }),
  AWS_SECRET_ACCESS_KEY: str({ desc: 'AWS Secret Access Key', default: '' }),
  S3_BUCKET_NAME: str({ desc: 'S3 Bucket Name for images', default: '' }),

  // Image Provider Selection
  IMAGE_PROVIDER: str({ choices: ['s3', 'imgbb', 'cloudinary'], default: 'cloudinary' }),

  // Instagram Cookies Path (supports both Windows and Linux)
  INSTAGRAM_COOKIES_PATH: str({
    desc: 'Path to Instagram cookies file',
    default: process.env.NODE_ENV === 'production'
      ? '/app/secrets/instagram_cookies.txt'  // Docker production path
      : path.join(process.cwd(), 'secrets', 'instagram_cookies.txt')  // Local development path
  }),
});
