declare module 'ffmpeg-static' {
  const path: string | null;
  export = path;
}

declare module 'ffprobe-static' {
  export const path: string;
}

// Extend Express Request to include requestId for tracing
import 'express';

declare global {
  namespace Express {
    interface Request {
      requestId?: string;
    }
  }
}
