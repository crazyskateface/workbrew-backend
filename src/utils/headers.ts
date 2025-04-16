/**
 * Utility functions for handling HTTP headers and CORS settings
 */

/**
 * Get the appropriate CORS origin based on the current environment
 * @returns The appropriate origin for CORS headers
 */
export function getCorsOrigin(): string {
  // Check for a specific override first
  if (process.env.CORS_ORIGIN) {
    return process.env.CORS_ORIGIN;
  }
  
  // Production environment
  if (process.env.NODE_ENV === 'production') {
    // return 'https://workbru.com';
    return 'http://localhost:5173'; // TODO: remove for production
  }
  
  // Staging environment
  if (process.env.NODE_ENV === 'staging') {
    return 'https://staging.workbru.com';
  }
  
  // For development or if we can't determine the environment,
  // allow multiple development origins
  return 'http://localhost:5173'; // This will match any origin in development
}

/**
 * Get the standard headers for API responses
 * @param additionalHeaders Optional additional headers to include
 * @returns Object containing standard headers for API responses
 */
export function getStandardHeaders(additionalHeaders: Record<string, string> = {}): Record<string, string> {
  return {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': getCorsOrigin(),
    'Access-Control-Allow-Headers': 'Content-Type,Authorization,X-CSRF-Token',
    'Access-Control-Allow-Methods': 'OPTIONS,POST,GET,PUT,DELETE',
    'Access-Control-Allow-Credentials': 'true',
    ...additionalHeaders
  };
}

/**
 * Get the headers for API responses with cookies
 * @param cookieHeader The cookie header to include
 * @param additionalHeaders Optional additional headers to include
 * @returns Object containing headers for API responses with cookies
 */
export function getCookieHeaders(cookieHeader: string, additionalHeaders: Record<string, string> = {}): Record<string, string> {
  return {
    ...getStandardHeaders(additionalHeaders),
    'Set-Cookie': cookieHeader
  };
}

/**
 * Get the headers for clearing cookies (logout)
 * @param additionalHeaders Optional additional headers to include
 * @returns Object containing headers for clearing cookies
 */
export function getClearCookieHeaders(additionalHeaders: Record<string, string> = {}): Record<string, string> {
    // TODO: use SameSite=Strict for production
  return getCookieHeaders('sessionId=; HttpOnly; Secure; SameSite=None; Path=/; Max-Age=0', additionalHeaders);
}

/**
 * Create a standard API response with proper headers
 * @param statusCode HTTP status code
 * @param body Response body
 * @param additionalHeaders Optional additional headers to include
 * @returns API Gateway-compatible response object
 */
export function createApiResponse(
  statusCode: number, 
  body: any,
  additionalHeaders: Record<string, string> = {}
) {
  return {
    statusCode,
    headers: getStandardHeaders(additionalHeaders),
    body: JSON.stringify(body)
  };
}

/**
 * Parse a response body from a string or object into a standardized format
 * @param message The message or object to include in the response
 * @param errorId Optional error ID for tracking
 * @returns Standardized response body object
 */
export function formatResponseBody(message: any, errorId?: string): Record<string, any> {
  let responseBody: Record<string, any> = {};
  
  if (typeof message === 'string') {
    responseBody.message = message;
  } else if (typeof message === 'object') {
    responseBody = { ...message };
    if (!responseBody.message) {
      responseBody.message = 'Success';
    }
  } else {
    responseBody.message = String(message);
  }
  
  if (errorId) {
    responseBody.errorId = errorId;
  }
  
  return responseBody;
}

/**
 * Create a standardized success response
 * @param message Success message or data
 * @param additionalHeaders Optional additional headers
 * @returns API Gateway-compatible success response
 */
export function createSuccessResponse(message: any, additionalHeaders: Record<string, string> = {}) {
  return createApiResponse(200, formatResponseBody(message), additionalHeaders);
}

/**
 * Create a standardized error response
 * @param statusCode HTTP status code
 * @param message Error message
 * @param errorId Optional error ID for tracking
 * @param additionalHeaders Optional additional headers
 * @returns API Gateway-compatible error response
 */
export function createErrorResponse(
  statusCode: number, 
  message: string, 
  errorId?: string, 
  additionalHeaders: Record<string, string> = {}
) {
  return createApiResponse(statusCode, formatResponseBody(message, errorId), additionalHeaders);
}