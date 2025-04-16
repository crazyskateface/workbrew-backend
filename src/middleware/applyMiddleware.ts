import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { csrfProtection, sessionMiddleware } from './csrfMiddleware.js';
import { corsMiddleware } from './corsMiddleware.js';

/**
 * Type for middleware functions
 */
export type Middleware = (
    event: APIGatewayProxyEvent,
    proceed: () => Promise<APIGatewayProxyResult>
) => Promise<APIGatewayProxyResult>;

/**
 * Type for a handler function
 */
export type Handler = (event: APIGatewayProxyEvent) => Promise<APIGatewayProxyResult>;

/**
 * Apply middleware to a handler function
 */
export function applyMiddleware(handler: Handler, ...middlewares: Middleware[]): Handler {
    return async (event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> => {
        // Create a function that represents the final handler
        let proceed: () => Promise<APIGatewayProxyResult> = () => handler(event);
        
        // Apply middleware in reverse order (so the first middleware in the list is executed first)
        for (let i = middlewares.length - 1; i >= 0; i--) {
            const middleware = middlewares[i];
            const next = proceed;
            proceed = () => middleware(event, next);
        }
        
        // Execute the middleware chain
        return proceed();
    };
}

/**
 * Apply standard middleware to a handler
 * This applies session, CSRF protection, and CORS headers to the handler
 */
export function withSessionAndCsrf(handler: Handler): Handler {
    return applyMiddleware(handler, corsMiddleware, sessionMiddleware, csrfProtection);
}

/**
 * Apply only session middleware and CORS headers to a handler
 * Useful for endpoints that need session data but don't require CSRF protection
 */
export function withSession(handler: Handler): Handler {
    return applyMiddleware(handler, corsMiddleware, sessionMiddleware);
}

/**
 * Apply only CORS middleware to a handler
 * Useful for public endpoints that don't need session or CSRF protection
 */
export function withCors(handler: Handler): Handler {
    return applyMiddleware(handler, corsMiddleware);
}