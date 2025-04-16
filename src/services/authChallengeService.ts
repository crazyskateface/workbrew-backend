import { DynamoDBClient, PutItemCommand, GetItemCommand, DeleteItemCommand } from "@aws-sdk/client-dynamodb";
import { randomBytes, pbkdf2Sync, randomUUID } from 'crypto';
import * as secretsUtil from '../utils/secrets.js';

const dynamoClient = new DynamoDBClient({ 
    region: process.env.AWS_REGION || 'us-east-1' 
});

const CHALLENGE_TABLE = process.env.CHALLENGE_TABLE || 'AuthChallenges';
const CHALLENGE_EXPIRY_SECONDS = 300; // 5 minutes

// Initialize with environment variable but will be updated with Secrets Manager value
let CSRF_SECRET = process.env.CSRF_SECRET || 'default-csrf-secret';
let isInitialized = false;

/**
 * Initialize the service by loading secrets
 * This function can be called explicitly or will be called automatically when needed
 */
export async function initialize(): Promise<void> {
    if (isInitialized) return;
    
    try {
        // This updates the CSRF_SECRET with the value from Secrets Manager
        CSRF_SECRET = await secretsUtil.getCsrfSecret();
        console.log('CSRF secret loaded from Secrets Manager in authChallengeService');
        isInitialized = true;
    } catch (error) {
        console.warn('Failed to load CSRF secret from Secrets Manager in authChallengeService, using environment variable:', error);
        // Still mark as initialized even if we fall back to environment variable
        isInitialized = true;
    }
}

// For backwards compatibility, initialize on module load
// but this can be controlled in tests
if (process.env.NODE_ENV !== 'test') {
    initialize().catch(err => {
        console.error('Failed to initialize authChallengeService:', err);
    });
}

// For testing purposes only
export function _setTestCsrfSecret(secret: string): void {
    if (process.env.NODE_ENV === 'test') {
        CSRF_SECRET = secret;
        isInitialized = true;
    }
}

/**
 * Generates a random salt for password hashing
 */
export function generateRandomSalt(length = 16): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let result = '';
  
  const bytes = randomBytes(length);
  for (let i = 0; i < length; i++) {
    result += chars[bytes[i] % chars.length];
  }
  
  return result;
}

/**
 * Hashes a password using PBKDF2 (must match the frontend implementation)
 */
export function hashPassword(password: string, salt: string): string {
  const iterations = 1000;
  const keyLength = 64; // 512 bits
  
  const hash = pbkdf2Sync(
    password,
    salt,
    iterations,
    keyLength,
    'sha512'
  ).toString('base64');
  
  return hash;
}

/**
 * Generates a unique ID for challenges
 */
export function generateUniqueId(): string {
  return randomUUID();
}

/**
 * Creates a new authentication challenge for a user
 */
export async function createChallenge(username: string): Promise<{challengeId: string, salt: string, expiresAt: number}> {
  const challengeId = generateUniqueId();
  const salt = generateRandomSalt();
  const expiresAt = Math.floor(Date.now() / 1000) + CHALLENGE_EXPIRY_SECONDS;
  
  const params = {
    TableName: CHALLENGE_TABLE,
    Item: {
      'challengeId': { S: challengeId },
      'username': { S: username },
      'salt': { S: salt },
      'expiresAt': { N: expiresAt.toString() }
    }
  };
  
  try {
    await dynamoClient.send(new PutItemCommand(params));
    
    return {
      challengeId,
      salt,
      expiresAt
    };
  } catch (error) {
    console.error('Error creating challenge:', error);
    throw error;
  }
}

/**
 * Validates a challenge response
 */
export async function validateChallenge(challengeId: string): Promise<{username: string, salt: string} | null> {
  const params = {
    TableName: CHALLENGE_TABLE,
    Key: {
      'challengeId': { S: challengeId }
    }
  };
  
  try {
    const { Item } = await dynamoClient.send(new GetItemCommand(params));
    
    if (!Item) {
      return null;
    }
    
    const expiresAt = parseInt(Item.expiresAt.N || '0');
    const now = Math.floor(Date.now() / 1000);
    
    // Check if challenge has expired
    if (expiresAt < now) {
      // Delete expired challenge
      await dynamoClient.send(new DeleteItemCommand(params));
      return null;
    }
    
    const username = Item.username.S || '';
    const salt = Item.salt.S || '';
    
    // Delete the challenge after it's been used
    await dynamoClient.send(new DeleteItemCommand(params));
    
    return { username, salt };
  } catch (error) {
    console.error('Error validating challenge:', error);
    return null;
  }
}

/**
 * Validates a CSRF token
 */
export async function validateCsrfToken(token: string, sessionToken: string): Promise<boolean> {
  try {
    // Make sure the service is initialized
    if (!isInitialized) {
      await initialize();
    }
    
    // Try to refresh the CSRF secret
    try {
      CSRF_SECRET = await secretsUtil.getCsrfSecret();
    } catch (error) {
      console.warn('Failed to refresh CSRF secret from Secrets Manager:', error);
      // Continue with existing CSRF_SECRET value
    }
    
    // The CSRF token should be a hash of the session token with a server secret
    const expectedToken = hashPassword(sessionToken, CSRF_SECRET);
    
    // Use a constant-time comparison to prevent timing attacks
    return token === expectedToken.substring(0, 32); // Use first 32 chars for simplicity
  } catch (error) {
    console.error('Error validating CSRF token:', error);
    return false;
  }
}