/**
 * Image Generator Utility (Lambda Proxy)
 * 
 * Replaces local heavy generation with AWS Lambda calls.
 */

import { invokeImageLambda } from '../services/external/lambdaImage.service';
import { logger } from './logger';
import { config } from '../config';

/**
 * Generate a single script image (or blueprint)
 * delegating to Lambda
 */
export async function generateScriptImage(scriptText: string): Promise<string> {
    // If Lambda is configured, use it
    if (config.AWS_LAMBDA_FUNCTION_NAME) {
        try {
            const result = await invokeImageLambda('single', scriptText);
            if (result.url) return result.url;
            throw new Error('Lambda returned no URL for single image');
        } catch (error: any) {
            logger.error(`Lambda script image generation failed: ${error.message}`);
            throw error;
        }
    }

    throw new Error('AWS Lambda not configured for image generation');
}

/**
 * Generate an Extract/Transcript image
 * delegating to Lambda
 */
export async function generateExtractImage(scriptText: string): Promise<string> {
    if (config.AWS_LAMBDA_FUNCTION_NAME) {
        try {
            // Use 'extract' type which maps to the Extract Template in Lambda
            const result = await invokeImageLambda('extract', scriptText);
            if (result.url) return result.url;
            throw new Error('Lambda returned no URL for extract image');
        } catch (error: any) {
            logger.error(`Lambda extract image generation failed: ${error.message}`);
            throw error;
        }
    }

    throw new Error('AWS Lambda not configured for extract generation');
}
