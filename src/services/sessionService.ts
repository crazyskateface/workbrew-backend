import { v4 as uuidv4 } from 'uuid';
import * as crypto from 'crypto';
import * as dynamodb from '../utils/dynamodb.js';
import { Session, SessionSchema } from '../models/session.js';
import * as authChallengeService from './authChallengeService.js';
import * as secretsUtil from '../utils/secrets.js';

// Constants
const SESSION_TABLE = process.env.SESSION_TABLE || 'workbru-sessions';
const SESSION_DURATION = 24 * 60 * 60 * 1000; // 24 hours in milliseconds
export const CSRF_ROTATION_INTERVAL = 15 * 60 * 1000; // 15 minutes in milliseconds

// Initialize with environment variable but will be updated with Secrets Manager value
let CSRF_SECRET = process.env.CSRF_SECRET || 'default-csrf-secret';

// Fetch CSRF secret from Secrets Manager on module load
(async () => {
    try {
        // This updates the CSRF_SECRET with the value from Secrets Manager
        CSRF_SECRET = await secretsUtil.getCsrfSecret();
        console.log('CSRF secret loaded from Secrets Manager');
    } catch (error) {
        console.warn('Failed to load CSRF secret from Secrets Manager, using environment variable:', error);
    }
})();

/**
 * Create a new session for a user
 */
export async function createSession(
    userId: string,
    username: string,
    userAgent?: string,
    ipAddress?: string
): Promise<Session> {
    // Using uuidv4 for session ID generation
    const sessionId = uuidv4();
    const now = Date.now();
    const expiresAt = now + SESSION_DURATION;
    
    // Get the CSRF secret and generate a token
    let csrfSecret;
    try {
        csrfSecret = await secretsUtil.getCsrfSecret();
    } catch (error) {
        console.warn('Failed to refresh CSRF secret from Secrets Manager:', error);
        // Fall back to environment variable
        csrfSecret = process.env.CSRF_SECRET || 'default-csrf-secret';
    }
    
    // Generate CSRF token using the session ID and secret
    const tokenInput = `${sessionId}:${now}`;
    const csrfToken = authChallengeService.hashPassword(tokenInput, csrfSecret).substring(0, 32);
    
    const session: Session = {
        sessionId,
        userId,
        username,
        csrfToken,
        userAgent,
        ipAddress,
        issuedAt: now,
        expiresAt,
        lastRotatedAt: now,
        lastActivityAt: now,
        isValid: true
    };
    
    // Validate session data
    SessionSchema.parse(session);
    
    // Store in DynamoDB
    await dynamodb.putItem(SESSION_TABLE, session);
    
    return session;
}

/**
 * Get a session by ID
 */
export async function getSessionById(sessionId: string): Promise<Session | null> {
    try {
        const session = await dynamodb.getItem(SESSION_TABLE, { sessionId });
        
        if (!session) {
            return null;
        }
        
        // Check if session is expired
        if (session.expiresAt < Date.now() || !session.isValid) {
            await invalidateSession(sessionId);
            return null;
        }
        
        return session as Session;
    } catch (error) {
        console.error('Error getting session:', error);
        return null;
    }
}

/**
 * Get all active sessions for a user
 */
export async function getUserSessions(userId: string): Promise<Session[]> {
    try {
        // This would use a GSI in DynamoDB with userId as the index key
        const sessions = await dynamodb.queryItems(
            SESSION_TABLE,
            'userId = :userId',
            { ':userId': userId },
            'userId-index' // Requires a GSI to be set up
        );
        
        // Filter out invalid or expired sessions
        const now = Date.now();
        return sessions
            .filter(session => session.isValid && session.expiresAt > now)
            .map(session => session as Session);
    } catch (error) {
        console.error('Error getting user sessions:', error);
        return [];
    }
}

/**
 * Invalidate a session (logout)
 */
export async function invalidateSession(sessionId: string): Promise<boolean> {
    try {
        await dynamodb.updateItem(
            SESSION_TABLE,
            { sessionId },
            'SET isValid = :isValid',
            {},
            { ':isValid': false }
        );
        return true;
    } catch (error) {
        console.error('Error invalidating session:', error);
        return false;
    }
}

/**
 * Invalidate all sessions for a user (force logout everywhere)
 */
export async function invalidateUserSessions(userId: string): Promise<boolean> {
    try {
        const sessions = await getUserSessions(userId);
        
        // Invalidate each session
        const promises = sessions.map(session => 
            invalidateSession(session.sessionId)
        );
        
        await Promise.all(promises);
        return true;
    } catch (error) {
        console.error('Error invalidating user sessions:', error);
        return false;
    }
}

/**
 * Update the lastActivityAt timestamp to keep the session alive
 */
export async function touchSession(sessionId: string): Promise<boolean> {
    try {
        const now = Date.now();
        
        // The expression doesn't use any attribute names with '#', so we don't need expressionAttributeNames
        await dynamodb.updateItem(
            SESSION_TABLE,
            { sessionId },
            'SET lastActivityAt = :lastActivityAt',
            null, // Pass null instead of empty object
            { ':lastActivityAt': now }
        );
        
        return true;
    } catch (error) {
        console.error('Error touching session:', error);
        return false;
    }
}

/**
 * Validate a CSRF token against a session
 */
export async function validateCsrfToken(sessionId: string, csrfToken: string): Promise<boolean> {
    try {
        const session = await getSessionById(sessionId);
        
        if (!session || !session.isValid) {
            return false;
        }
        
        // Check if the CSRF token matches
        return session.csrfToken === csrfToken;
    } catch (error) {
        console.error('Error validating CSRF token:', error);
        return false;
    }
}

/**
 * Rotate the CSRF token for a session
 */
export async function rotateCsrfToken(sessionId: string): Promise<string | null> {
    try {
        const session = await getSessionById(sessionId);
        
        // We should return null early and not attempt to get the secret
        // if the session is invalid or expired
        if (!session || !session.isValid) {
            return null;
        }
        
        // Check if rotation is needed based on time interval
        const now = Date.now();
        if (session.lastRotatedAt && 
            (now - session.lastRotatedAt) < CSRF_ROTATION_INTERVAL) {
            // No need to rotate yet
            return session.csrfToken;
        }
        
        // Get the CSRF secret directly
        let csrfSecret;
        try {
            csrfSecret = await secretsUtil.getCsrfSecret();
        } catch (error) {
            console.warn('Failed to refresh CSRF secret from Secrets Manager:', error);
            // Fall back to environment variable
            csrfSecret = process.env.CSRF_SECRET || 'default-csrf-secret';
        }
        
        // Generate a new token with the session ID and the secret
        const tokenInput = `${sessionId}:${now}`;
        const newCsrfToken = authChallengeService.hashPassword(tokenInput, csrfSecret).substring(0, 32);
        
        // Update the session with the new token
        await dynamodb.updateItem(
            SESSION_TABLE,
            { sessionId },
            'SET csrfToken = :csrfToken, lastRotatedAt = :lastRotatedAt',
            {},
            { 
                ':csrfToken': newCsrfToken,
                ':lastRotatedAt': now
            }
        );
        
        return newCsrfToken;
    } catch (error) {
        console.error('Error rotating CSRF token:', error);
        return null;
    }
}

/**
 * Extend the session expiration time
 */
export async function extendSession(sessionId: string): Promise<boolean> {
    try {
        const session = await getSessionById(sessionId);
        
        if (!session || !session.isValid) {
            return false;
        }
        
        const now = Date.now();
        const newExpiresAt = now + SESSION_DURATION;
        
        await dynamodb.updateItem(
            SESSION_TABLE,
            { sessionId },
            'SET expiresAt = :expiresAt, lastActivityAt = :lastActivityAt',
            {},
            { 
                ':expiresAt': newExpiresAt,
                ':lastActivityAt': now
            }
        );
        
        return true;
    } catch (error) {
        console.error('Error extending session:', error);
        return false;
    }
}

/**
 * Clean up expired sessions (would be called by a scheduled Lambda)
 */
export async function cleanupExpiredSessions(): Promise<number> {
    try {
        const allSessions = await dynamodb.scanItems(SESSION_TABLE);
        const now = Date.now();
        
        const expiredSessions = allSessions.filter(
            session => session.expiresAt < now
        );
        
        // Delete each expired session
        const promises = expiredSessions.map(session => 
            dynamodb.deleteItem(SESSION_TABLE, { sessionId: session.sessionId })
        );
        
        await Promise.all(promises);
        return expiredSessions.length;
    } catch (error) {
        console.error('Error cleaning up expired sessions:', error);
        return 0;
    }
}

/**
 * Generate a CSRF token for a session
 */
async function generateCsrfToken(sessionId: string): Promise<string> {
    let secret = CSRF_SECRET;
    
    // Always fetch the latest CSRF secret from Secrets Manager
    try {
        secret = await secretsUtil.getCsrfSecret();
    } catch (error) {
        console.warn('Failed to refresh CSRF secret from Secrets Manager:', error);
        // Fall back to environment variable
        secret = process.env.CSRF_SECRET || 'default-csrf-secret';
    }
    
    // Generate a token that combines session ID with timestamp for uniqueness
    const tokenInput = `${sessionId}-${Date.now().toString()}`;
    
    // Hash the token with the secret
    const hashedToken = authChallengeService.hashPassword(tokenInput, secret);
    
    // Return first 32 characters for a reasonable token length
    return hashedToken.substring(0, 32);
}

/**
 * Set a secure HTTP-only cookie with the session ID
 */
export function getSessionCookieHeader(sessionId: string, secure: boolean = true): string {
    const maxAge = SESSION_DURATION / 1000; // Convert to seconds
    // TODO: Use SameSite= 'Strict' for better CSRF protection
    return `sessionId=${sessionId}; HttpOnly; ${secure ? 'Secure; ' : ''}SameSite=None; Path=/; Max-Age=${maxAge}`;
}

/**
 * Get session ID from cookie string
 */
export function getSessionIdFromCookie(cookieHeader?: string): string | null {
    if (!cookieHeader) {
        return null;
    }
    
    const cookies = cookieHeader.split(';');
    
    for (const cookie of cookies) {
        const [name, value] = cookie.trim().split('=');
        if (name === 'sessionId') {
            return value;
        }
    }
    
    return null;
}