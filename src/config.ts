import { cleanEnv, str, port, num } from 'envalid';
import dotenv from 'dotenv';
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
  MANYCHAT_SCRIPT_FIELD_ID: str({ desc: 'Field ID for script image URL', default: '' }),
  MANYCHAT_COPY_FIELD_ID: str({ desc: 'Field ID for script copy URL', default: '' }),
  MANYCHAT_ENABLE_DIRECT_MESSAGING: str({ desc: 'Enable direct message sending', default: 'false' }),
  
  // Image Services
  IMGBB_API_KEY: str({ desc: 'API Key for ImgBB' }),
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
  IMAGE_PROVIDER: str({ choices: ['s3', 'imgbb'], default: 'imgbb' }),
  
  // Instagram Cookies Path
  INSTAGRAM_COOKIES_PATH: str({ desc: 'Path to Instagram cookies file', default: '/app/secrets/instagram_cookies.txt' }),
});
