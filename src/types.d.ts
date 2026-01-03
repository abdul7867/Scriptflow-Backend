declare module 'ffmpeg-static' {
  const path: string | null;
  export = path;
}

declare module 'ffprobe-static' {
  export const path: string;
}

// Extend Express Request to include requestId for tracing
import { Request } from 'express';

declare module 'express-serve-static-core' {
  interface Request {
    requestId?: string;
  }
}
