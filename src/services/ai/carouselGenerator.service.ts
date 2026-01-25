/**
 * Carousel Generator Service (Lambda Proxy)
 * 
 * Offloads image generation to AWS Lambda to prevent local memory exhaustion.
 * Maintains the same interface for compatibility.
 */

import { logger } from '../../utils/logger';
import { getVariationTag } from '../../utils/hash';
import { invokeImageLambda } from '../external/lambdaImage.service';
import { config } from '../../config';

// ═══════════════════════════════════════════════════════════════════════════
// TYPES
// ═══════════════════════════════════════════════════════════════════════════

export interface ScriptSections {
  hook: string[];
  body: string[];
  cta: string[];
}

export interface CarouselImages {
  hookCard: string;      // URL for hook card image
  bodyCard: string;      // URL for body card image
  ctaCard: string;       // URL for CTA card image
  combined?: string;     // URL for combined single image (fallback)
}

export interface CarouselConfig {
  variationIndex: number;
  showTimings: boolean;
  theme: 'dark' | 'light';
  storyFormat?: 'story' | 'edgy' | 'tutorial' | 'default';  // Format for layout
  remixType?: string;  // For remix badge (shorter, funnier, etc.)
}

/**
 * Generate 3-card carousel by invoking AWS Lambda
 */
export async function generateCarouselImages(
  scriptText: string,
  carouselConfig: CarouselConfig
): Promise<CarouselImages> {
  const variationTag = getVariationTag(carouselConfig.variationIndex);

  if (config.AWS_LAMBDA_FUNCTION_NAME) {
    try {
      const response = await invokeImageLambda('carousel', scriptText, variationTag, {
        format: carouselConfig.storyFormat,
        remixType: carouselConfig.remixType
      });

      if (response.hookUrl && response.bodyUrl && response.ctaUrl) {
        return {
          hookCard: response.hookUrl,
          bodyCard: response.bodyUrl,
          ctaCard: response.ctaUrl,
          // Use body card as fallback/preview for combined since we don't generate the long strip in Lambda to save memory
          combined: response.bodyUrl
        };
      }
      throw new Error('Lambda did not return all 3 carousel card URLs');
    } catch (error: any) {
      logger.error('Lambda carousel generation failed, falling back to local?', error);
      // Fallback to local logic would require importing the heavy code. 
      // User explicitly requested "Zero Crash", so we throw Error rather than crash server.
      throw new Error(`Carousel Generation Failed: ${error.message}`);
    }
  } else {
    throw new Error('AWS Lambda not configured. Cannot generate carousel images safely.');
  }
}

/**
 * Helper to parse script sections (Kept for compatibility if needed elsewhere)
 */
export function parseScriptSections(scriptText: string): ScriptSections {
  // Simplified version just for basic validation if needed
  const sections: ScriptSections = { hook: [], body: [], cta: [] };
  const parts = scriptText.split(/(?:🎬|📝|🚀)?\s*\[(HOOK|BODY|CTA)(?:\s*\([^)]*\))?\]/i);
  for (let i = 1; i < parts.length; i += 2) {
    const h = parts[i]?.toUpperCase();
    const c = parts[i + 1]?.trim() || '';
    const l = c.split('\n').map(x => x.trim()).filter(x => x.length);
    if (h === 'HOOK') sections.hook = l;
    else if (h === 'BODY') sections.body = l;
    else if (h === 'CTA') sections.cta = l;
  }
  return sections;
}
