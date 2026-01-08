import fs from 'fs';
import { logger } from '../utils/logger';

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
