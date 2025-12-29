import ffmpeg from 'fluent-ffmpeg';
import path from 'path';
import { logger } from '../utils/logger';
import { config } from '../config';

if (config.FFMPEG_PATH) ffmpeg.setFfmpegPath(config.FFMPEG_PATH);
if (config.FFPROBE_PATH) ffmpeg.setFfprobePath(config.FFPROBE_PATH);

export async function extractAudio(videoPath: string, id: string): Promise<string | null> {
  const outputPath = path.join(path.dirname(videoPath), `${id}.wav`);

  return new Promise((resolve) => {
    ffmpeg(videoPath)
      .noVideo()
      .audioChannels(1)
      .audioFrequency(16000)
      .toFormat('wav')
      .on('end', () => {
        resolve(outputPath);
      })
      .on('error', (err) => {
        logger.warn(`Audio extraction issue: ${err.message}`);
        resolve(null);
      })
      .save(outputPath);
  });
}
