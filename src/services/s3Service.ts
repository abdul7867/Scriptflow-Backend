import { S3Client, PutObjectCommand } from '@aws-sdk/client-s3';
import { config } from '../config';
import { logger } from '../utils/logger';
import path from 'path';

// Initialize S3 Client only if credentials are provided
let s3Client: S3Client | null = null;

if (config.AWS_ACCESS_KEY_ID && config.AWS_SECRET_ACCESS_KEY) {
  s3Client = new S3Client({
    region: config.AWS_REGION,
    credentials: {
      accessKeyId: config.AWS_ACCESS_KEY_ID,
      secretAccessKey: config.AWS_SECRET_ACCESS_KEY
    }
  });
  logger.info('✅ AWS S3 Client initialized');
} else {
  logger.warn('⚠️ AWS credentials missing. S3 uploads will fail if selected.');
}

/**
 * Upload a file buffer to S3
 * @param buffer - File content as buffer
 * @param filename - Desired filename
 * @param contentType - MIME type (default: image/png)
 * @returns The public URL of the uploaded file
 */
export async function uploadToS3(
  buffer: Buffer, 
  filename: string, 
  contentType: string = 'image/png'
): Promise<string> {
  if (!s3Client) {
    throw new Error('S3 Client not initialized. Check AWS credentials.');
  }

  const bucket = config.S3_BUCKET_NAME;
  if (!bucket) {
    throw new Error('S3_BUCKET_NAME is not defined in config.');
  }

  // Generate a unique key with timestamp to avoid caching issues/collisions
  // Format: uploads/YYYY-MM-DD/timestamp-filename
  const date = new Date().toISOString().split('T')[0];
  const timestamp = Date.now();
  const key = `uploads/${date}/${timestamp}-${filename}`;

  try {
    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: buffer,
      ContentType: contentType,
      // ACL: 'public-read' // NOTE: Modern S3 buckets often block ACLs. Use Bucket Policy instead.
    });

    await s3Client.send(command);

    const fileUrl = `https://${bucket}.s3.${config.AWS_REGION}.amazonaws.com/${key}`;
    logger.info(`Successfully uploaded to S3: ${fileUrl}`);
    
    return fileUrl;

  } catch (error: any) {
    logger.error('Failed to upload to S3:', error);
    throw new Error(`S3 Upload failed: ${error.message}`);
  }
}

/**
 * Generate S3 URL from key (helper)
 */
export function generateS3Url(key: string): string {
  return `https://${config.S3_BUCKET_NAME}.s3.${config.AWS_REGION}.amazonaws.com/${key}`;
}
