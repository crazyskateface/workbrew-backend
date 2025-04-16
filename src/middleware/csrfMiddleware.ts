import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import * as sessionService from '../services/sessionService.js';

// Methods that require CSRF protection
const CSRF_PROTECTED_METHODS = ['POST', 'PUT', 'DELETE', 'PATCH'];

// Routes that don't need CSRF protection
const CSRF_EXEMPT_ROUTES = [
    '/auth/login',
    '/auth/register',
    '/auth/challenge/request',
    '/auth/challenge/login'
];

/**
 * Middleware to validate CSRF tokens for protected routes
 */
export async function csrfProtection(
    event: APIGatewayProxyEvent,
    proceed: () => Promise<APIGatewayProxyResult>
): Promise<APIGatewayProxyResult> {
    // Skip CSRF validation for certain routes and methods
    const requestPath = event.path;
    const requestMethod = event.httpMethod;
    
    // Skip validation for GET requests and exempt routes
    if (
        !CSRF_PROTECTED_METHODS.includes(requestMethod) ||
        CSRF_EXEMPT_ROUTES.some(route => requestPath.startsWith(route))
    ) {
        return await proceed();
    }
    
    // Get the session ID from cookie
    const cookieHeader = event.headers.Cookie || event.headers.cookie;
    const sessionId = sessionService.getSessionIdFromCookie(cookieHeader);
    
    if (!sessionId) {
        return {
            statusCode: 401,
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                message: 'Authentication required - session token missing'
            })
        };
    }
    
    // Get CSRF token from header
    const csrfToken = event.headers['X-CSRF-Token'] || event.headers['x-csrf-token'];
    
    if (!csrfToken) {
        return {
            statusCode: 403,
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                message: 'CSRF token required'
            })
        };
    }
    
    // Validate the CSRF token
    const isValid = await sessionService.validateCsrfToken(sessionId, csrfToken);
    
    if (!isValid) {
        return {
            statusCode: 403,
            headers: {
                'Content-Type': 'application/json'
            },
            body: JSON.stringify({
                message: 'Invalid or expired CSRF token'
            })
        };
    }
    
    // Touch the session to update lastActivityAt
    await sessionService.touchSession(sessionId);
    
    // Continue with the request
    return await proceed();
}

/**
 * Helper to add session info to the event for use in handlers
 */
export function addSessionToEvent(
    event: APIGatewayProxyEvent, 
    sessionId: string
): APIGatewayProxyEvent {
    // Add sessionId to event for use in handlers
    if (!event.requestContext.authorizer) {
        event.requestContext.authorizer = {};
    }
    
    // Add session info to the authorizer object
    event.requestContext.authorizer.sessionId = sessionId;
    
    return event;
}

/**
 * Middleware to handle sessions and CSRF together
 */
export async function sessionMiddleware(
    event: APIGatewayProxyEvent,
    proceed: () => Promise<APIGatewayProxyResult>
): Promise<APIGatewayProxyResult> {
    // Get the session ID from cookie
    const cookieHeader = event.headers.Cookie || event.headers.cookie;
    const sessionId = sessionService.getSessionIdFromCookie(cookieHeader);
    
    // If no session, just proceed (authentication checks happen elsewhere)
    if (!sessionId) {
        return await proceed();
    }
    
    // Validate the session
    const session = await sessionService.getSessionById(sessionId);
    
    if (!session || !session.isValid) {
        // Clear the invalid cookie
        return {
            statusCode: 401,
            headers: {
                'Content-Type': 'application/json',
                'Set-Cookie': 'sessionId=; HttpOnly; Secure; SameSite=Strict; Path=/; Max-Age=0'
            },
            body: JSON.stringify({
                message: 'Invalid or expired session'
            })
        };
    }
    
    // Add session info to event for handlers to use
    addSessionToEvent(event, sessionId);
    
    // Check CSRF token for protected methods
    const requestMethod = event.httpMethod;
    const requestPath = event.path;
    
    if (
        CSRF_PROTECTED_METHODS.includes(requestMethod) &&
        !CSRF_EXEMPT_ROUTES.some(route => requestPath.startsWith(route))
    ) {
        // Get CSRF token from header
        const csrfToken = event.headers['X-CSRF-Token'] || event.headers['x-csrf-token'];
        
        if (!csrfToken) {
            return {
                statusCode: 403,
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    message: 'CSRF token required'
                })
            };
        }
        
        // Validate the CSRF token
        const isValid = session.csrfToken === csrfToken;
        
        if (!isValid) {
            return {
                statusCode: 403,
                headers: {
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    message: 'Invalid CSRF token'
                })
            };
        }
    }
    
    // Touch the session to update lastActivityAt
    await sessionService.touchSession(sessionId);
    
    // Check if we need to rotate the CSRF token
    let headers: Record<string, string> = {};
    
    if (
        session.lastRotatedAt && 
        (Date.now() - session.lastRotatedAt) >= sessionService.CSRF_ROTATION_INTERVAL
    ) {
        const newCsrfToken = await sessionService.rotateCsrfToken(sessionId);
        
        if (newCsrfToken) {
            headers['X-New-CSRF-Token'] = newCsrfToken;
        }
    }
    
    // Proceed with the request
    const result = await proceed();
    
    // Add any headers we've set
    return {
        ...result,
        headers: { ...result.headers, ...headers }
    };
}