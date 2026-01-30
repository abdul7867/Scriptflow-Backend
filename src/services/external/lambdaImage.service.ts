import { LambdaClient, InvokeCommand, LogType } from '@aws-sdk/client-lambda';
import { config } from '../../config';
import { logger } from '../../utils/logger';

// Initialize Lambda Client
const lambdaClient = new LambdaClient({
    region: config.AWS_REGION,
    credentials: {
        accessKeyId: config.AWS_ACCESS_KEY_ID,
        secretAccessKey: config.AWS_SECRET_ACCESS_KEY,
    },
});

interface LambdaImageResponse {
    url?: string;
    hookUrl?: string;
    bodyUrl?: string;
    ctaUrl?: string;
    error?: string;
}

/**
 * Invoke AWS Lambda to generate image(s)
 * Offloads heavy Satori/Resvg processing to serverless
 */
export async function invokeImageLambda(
    type: 'single' | 'carousel' | 'extract',
    scriptText: string,
    variationTag: string = 'v1',
    options: { format?: string; remixType?: string } = {}
): Promise<LambdaImageResponse> {
    const functionName = config.AWS_LAMBDA_FUNCTION_NAME;

    if (!functionName) {
        throw new Error('AWS_LAMBDA_FUNCTION_NAME not configured');
    }

    logger.info(`Invoking Lambda [${functionName}] type=${type} format=${options.format}`);
    const startTime = Date.now();

    try {
        const payload = JSON.stringify({
            type,
            scriptText,
            variationTag,
            format: options.format,
            remixType: options.remixType
        });

        const command = new InvokeCommand({
            FunctionName: functionName,
            Payload: Buffer.from(payload),
            LogType: LogType.Tail,
        });

        const response = await lambdaClient.send(command);
        const duration = Date.now() - startTime;

        if (response.FunctionError) {
            const errorPayload = response.Payload ? Buffer.from(response.Payload).toString() : 'Unknown error';
            logger.error(`Lambda execution failed (${duration}ms): ${errorPayload}`);
            throw new Error(`Lambda functionality error: ${errorPayload}`);
        }

        const resultPayload = response.Payload ? Buffer.from(response.Payload).toString() : '{}';
        let result = JSON.parse(resultPayload);

        // Handle Lambda Proxy Response (API Gateway style)
        if (result.statusCode && result.body) {
            if (result.statusCode !== 200) {
                throw new Error(`Lambda returned status ${result.statusCode}: ${result.body}`);
            }
            // Parse the body string into the actual response object
            result = typeof result.body === 'string' ? JSON.parse(result.body) : result.body;
        }

        if (result.error) {
            throw new Error(`Lambda reported error: ${result.error}`);
        }

        logger.info(`Lambda invocation successful (${duration}ms)`);
        return result as LambdaImageResponse;

    } catch (error: any) {
        logger.error(`Lambda invocation error: ${error.message}`);
        throw error;
    }
}
