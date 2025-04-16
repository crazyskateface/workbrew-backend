import { SecretsManagerClient, GetSecretValueCommand } from '@aws-sdk/client-secrets-manager';

// For testing: allow overriding the client
let _secretsClient: any = null;

// Initialize the Secrets Manager client
const createDefaultClient = () => new SecretsManagerClient({
    region: process.env.AWS_REGION || 'us-east-1'
});

// Get the secrets client (allows overriding for tests)
export const getSecretsClient = () => {
    if (!_secretsClient) {
        _secretsClient = createDefaultClient();
    }
    return _secretsClient;
};

// For testing: reset the client
export const resetSecretsClient = () => {
    _secretsClient = null;
};

// For testing: set a mock client
export const setMockSecretsClient = (mockClient: any) => {
    _secretsClient = mockClient;
};

// Cache for secrets to avoid repeated calls to Secrets Manager
const secretsCache = new Map();
const CACHE_TTL = 15 * 60 * 1000; // 15 minutes in milliseconds

/**
 * Retrieves a secret from AWS Secrets Manager
 * @param {string} secretName - The name of the secret to retrieve
 * @param {string} [secretKey] - Optional key if the secret is a JSON object
 * @returns {Promise<string>} - The secret value
 */
export async function getSecret(secretName:string, secretKey: string | null = null) {
    // For local development, use environment variables
    if (process.env.NODE_ENV !== 'production') {
        return secretKey ? process.env[secretKey] || 'local-development-secret' : 'local-development-secret';
    }
    
    // Check if the secret is in the cache and not expired
    const cacheKey = secretKey ? `${secretName}:${secretKey}` : secretName;
    const cachedItem = secretsCache.get(cacheKey);
    
    if (cachedItem && Date.now() - cachedItem.timestamp < CACHE_TTL) {
        return cachedItem.value;
    }
    
    try {
        // Fetch the secret from AWS Secrets Manager
        const command = new GetSecretValueCommand({
            SecretId: secretName,
        });
        
        const response = await getSecretsClient().send(command);
        let secretValue;
        
        // Parse the secret if it's JSON
        if (secretKey) {
            const secretJson = JSON.parse(response.SecretString || '{}');
            secretValue = secretJson[secretKey];
        } else {
            secretValue = response.SecretString;
        }
        
        // Cache the secret
        secretsCache.set(cacheKey, {
            value: secretValue,
            timestamp: Date.now()
        });
        
        return secretValue;
    } catch (error) {
        console.error(`Error retrieving secret ${secretName}:`, error);
        
        // Fallback to environment variable if available
        if (secretKey && process.env[secretKey]) {
            return process.env[secretKey];
        }
        
        const errorMessage = error instanceof Error ? error.message : String(error);
        throw new Error(`Failed to retrieve secret: ${errorMessage}`);
    }
}

/**
 * Gets the CSRF secret used for token generation and validation
 * @returns {Promise<string>} - The CSRF secret
 */
export async function getCsrfSecret() {
    // Name of the secret in AWS Secrets Manager
    const secretName = 'WorkbruAppSecrets';
    const secretKey = 'CSRF_SECRET';
    
    try {
        return await getSecret(secretName, secretKey);
    } catch (error) {
        // Fallback to environment variable
        return process.env.CSRF_SECRET || 'default-csrf-secret';
    }
}

/**
 * Clear the secrets cache
 * This is useful for testing or when you need to force a refresh
 */
export function clearSecretsCache() {
    secretsCache.clear();
}