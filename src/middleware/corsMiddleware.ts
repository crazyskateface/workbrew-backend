import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { Middleware } from './applyMiddleware.js';
import * as headerUtils from '../utils/headers.js';

/**
 * Middleware to handle CORS preflight requests and add CORS headers to all responses
 */
export const corsMiddleware: Middleware = async (event: APIGatewayProxyEvent, proceed) => {
  // Handle OPTIONS preflight requests
  if (event.httpMethod === 'OPTIONS') {
    return {
      statusCode: 200,
      headers: headerUtils.getStandardHeaders(),
      body: ''
    };
  }

  // For all other requests, proceed with the handler but ensure CORS headers are added
  const response = await proceed();
  
  // Add CORS headers to the response
  return {
    ...response,
    headers: {
      ...response.headers,
      ...headerUtils.getStandardHeaders()
    }
  };
};