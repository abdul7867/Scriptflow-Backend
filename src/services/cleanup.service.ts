import fs from 'fs';
import path from 'path';
import { logger } from '../utils/logger';

/**
 * Clean up individual files
 */
export function cleanupFiles(files: (string | null)[]) {
  files.forEach(file => {
    if (file && fs.existsSync(file)) {
      try {
        fs.unlinkSync(file);
        logger.info(`Cleaned up file: ${file}`);
      } catch (error) {
        logger.error(`Failed to delete file: ${file}`, error);
      }
    }
  });
}

/**
 * Force cleanup of temp directory
 * This is called after every job (success or failure) to prevent memory leaks.
 * Deletes all files older than 5 minutes to avoid interfering with active jobs.
 * 
 * @param tempBasePath - The base temp directory path (defaults to process.cwd()/temp)
 * @param maxAgeMs - Maximum age of files to keep (default: 5 minutes)
 */
export function forceCleanupTempDir(
  tempBasePath: string = path.join(process.cwd(), 'temp'),
  maxAgeMs: number = 5 * 60 * 1000 // 5 minutes
): { deletedFiles: number; deletedDirs: number; errors: string[] } {
  const result = {
    deletedFiles: 0,
    deletedDirs: 0,
    errors: [] as string[]
  };

  if (!fs.existsSync(tempBasePath)) {
    return result;
  }

  const now = Date.now();

  try {
    const items = fs.readdirSync(tempBasePath);

    for (const item of items) {
      const itemPath = path.join(tempBasePath, item);

      try {
        const stat = fs.statSync(itemPath);
        const age = now - stat.mtimeMs;

        // Only delete items older than maxAgeMs
        if (age < maxAgeMs) {
          continue;
        }

        if (stat.isDirectory()) {
          // Recursively delete directory contents
          const files = fs.readdirSync(itemPath);
          for (const file of files) {
            try {
              fs.unlinkSync(path.join(itemPath, file));
              result.deletedFiles++;
            } catch (e: any) {
              result.errors.push(`Failed to delete ${path.join(itemPath, file)}: ${e.message}`);
            }
          }

          // Remove the directory
          try {
            fs.rmdirSync(itemPath);
            result.deletedDirs++;
          } catch (e: any) {
            result.errors.push(`Failed to remove dir ${itemPath}: ${e.message}`);
          }
        } else {
          // Delete file
          fs.unlinkSync(itemPath);
          result.deletedFiles++;
        }
      } catch (e: any) {
        result.errors.push(`Error processing ${itemPath}: ${e.message}`);
      }
    }

    if (result.deletedFiles > 0 || result.deletedDirs > 0) {
      logger.info('Force cleanup completed', {
        deletedFiles: result.deletedFiles,
        deletedDirs: result.deletedDirs,
        errors: result.errors.length
      });
    }
  } catch (error: any) {
    logger.error(`Force cleanup failed: ${error.message}`);
    result.errors.push(`Main error: ${error.message}`);
  }

  return result;
}

/**
 * Schedule periodic cleanup of temp directory
 * This runs every 2 minutes to catch any orphaned files
 */
let cleanupInterval: NodeJS.Timeout | null = null;

export function startPeriodicCleanup(intervalMs: number = 2 * 60 * 1000): void {
  if (cleanupInterval) {
    logger.warn('Periodic cleanup already running');
    return;
  }

  cleanupInterval = setInterval(() => {
    forceCleanupTempDir();
  }, intervalMs);

  logger.info(`Started periodic temp cleanup (every ${intervalMs / 1000}s)`);
}

export function stopPeriodicCleanup(): void {
  if (cleanupInterval) {
    clearInterval(cleanupInterval);
    cleanupInterval = null;
    logger.info('Stopped periodic temp cleanup');
  }
}
