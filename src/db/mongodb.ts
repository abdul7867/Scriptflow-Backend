import mongoose from 'mongoose';
import { logger } from '../utils/logger';

let isConnected = false;

/**
 * Connect to MongoDB with retry logic and connection pooling.
 * Uses exponential backoff for retries.
 */
export async function connectDB(): Promise<void> {
  if (isConnected) {
    logger.info('MongoDB already connected');
    return;
  }

  const mongoUri = process.env.MONGODB_URI;
  
  if (!mongoUri) {
    throw new Error('MONGODB_URI environment variable is not defined');
  }

  const options: mongoose.ConnectOptions = {
    // Connection pooling for handling concurrent requests
    maxPoolSize: 50,           // Maximum 50 connections in the pool
    minPoolSize: 5,            // Always keep 5 connections ready
    maxIdleTimeMS: 30000,      // Close idle connections after 30s
    serverSelectionTimeoutMS: 5000,
    socketTimeoutMS: 45000,
    retryWrites: true,
    w: 'majority'
  };

  const maxRetries = 5;
  let retryCount = 0;

  while (retryCount < maxRetries) {
    try {
      await mongoose.connect(mongoUri, options);
      isConnected = true;
      logger.info('✅ MongoDB connected successfully');
      
      // Connection event handlers
      mongoose.connection.on('error', (err) => {
        logger.error('MongoDB connection error:', err);
        isConnected = false;
      });

      mongoose.connection.on('disconnected', () => {
        logger.warn('MongoDB disconnected. Attempting reconnection...');
        isConnected = false;
      });

      mongoose.connection.on('reconnected', () => {
        logger.info('MongoDB reconnected');
        isConnected = true;
      });

      return;
    } catch (error) {
      retryCount++;
      const delay = Math.pow(2, retryCount) * 1000; // Exponential backoff
      logger.error(`MongoDB connection attempt ${retryCount}/${maxRetries} failed. Retrying in ${delay}ms...`, error);
      
      if (retryCount >= maxRetries) {
        throw new Error(`Failed to connect to MongoDB after ${maxRetries} attempts`);
      }
      
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

/**
 * Gracefully disconnect from MongoDB
 */
export async function disconnectDB(): Promise<void> {
  if (!isConnected) {
    return;
  }

  try {
    await mongoose.disconnect();
    isConnected = false;
    logger.info('MongoDB disconnected gracefully');
  } catch (error) {
    logger.error('Error disconnecting from MongoDB:', error);
    throw error;
  }
}

/**
 * Check if MongoDB is connected
 */
export function isMongoConnected(): boolean {
  return isConnected && mongoose.connection.readyState === 1;
}

export default mongoose;
