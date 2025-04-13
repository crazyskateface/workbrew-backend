import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import * as userService from '../services/userService.js';
import * as permissionService from '../services/permissionService.js';
import { v4 as uuidv4 } from 'uuid';

export async function getUser(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    try{
        // get user id from path parameter or from the JWT token
        let userId = event.pathParameters?.userId;

        // if no user ID specified, use the authenticated user's ID
        if (!userId) {
            // extract user ID from Cognito authorizer context 
            userId = event.requestContext.authorizer?.claims?.sub;
        }

        if (!userId){
            return buildRes(400, 'Missing user Id');
        }

        const user = await userService.getUserById(userId);

        if (!user) {
            return buildRes(404, 'User not found');
        }

        return buildRes(200, user);
    } catch (error) {
        console.error('Error fetching user: ', error);

        const errorId = uuidv4();
        console.error(`Error ID: ${errorId}`, error);

        return buildRes(500, 'Error fetching user', error);
    }
}

export async function updateUser(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    try {
        // Get user ID from path parameter or from the JWT token
        let userId = event.pathParameters?.userId;
        
        // If no user ID specified, use the authenticated user's ID
        if (!userId) {
            // Extract user ID from Cognito authorizer context
            userId = event.requestContext.authorizer?.claims?.sub;
        }
        
        if (!userId) {
            return buildRes(400, 'Missing user ID');
        }

        if (!event.body) {
            return buildRes(400, 'Missing request body');
        }

        // Check if user exists
        const existingUser = await userService.getUserByIdOrUsername(userId);
        if (!existingUser) {
            return buildRes(404, 'User not found');
        }

        // Check if the authenticated user can update this user
        const authenticatedUserId = event.requestContext.authorizer?.claims?.sub;
        const authenticatedUsername = event.requestContext.authorizer?.claims?.['cognito:username'];

        if (!authenticatedUserId) {
            return buildRes(401, 'Authentication required');
        }

        console.log(`Auth user ID: ${authenticatedUserId}, username: ${authenticatedUsername}`);
        console.log(`Requested to update user: ${userId}`);

        if (userId !== authenticatedUserId) {
            // Check admin status through the database using the authenticated user's ID
            const isAdmin = await permissionService.isUserAdmin(authenticatedUserId);
            console.log(`Admin check for ${authenticatedUserId}: ${isAdmin}`);
            
            if (!isAdmin) {
                // Also try with the username as a fallback
                const isAdminByUsername = await permissionService.isUserAdmin(authenticatedUsername);
                console.log(`Admin check for username ${authenticatedUsername}: ${isAdminByUsername}`);
                
                if (!isAdminByUsername) {
                    return buildRes(403, 'Forbidden - You can only update your own profile');
                }
            }
        }
        
        const updateData = JSON.parse(event.body);
        const updatedUser = await userService.updateUser(existingUser.id, updateData);
        return buildRes(200, updatedUser);
    } catch (error) {
        console.error('Error updating user: ', error);

        const errorId = uuidv4();
        console.error(`Error ID: ${errorId}`, error);
        
        return buildRes(500, 'Error updating user', error);
    }
}

export async function setAdminStatus(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    try { 
        // extract the auth'd user's id
        const userId = event.requestContext.authorizer?.claims?.sub;
        if (!userId) {
            return buildRes(401, 'Authentication required');
        }

        // only admins can set admin status
        const isAdmin = await permissionService.isUserAdmin(userId);
        if (!isAdmin) {
            return buildRes(403, 'Only administrators can perform this action');
        }

        const targetUserId = event.pathParameters?.userId;
        if (!targetUserId) {
            return buildRes(400, 'Missing target user ID');
        }

        if (!event.body) {
            return buildRes(400, 'Missing request body');
        }

        const { isAdmin: setAdminStatus} = JSON.parse(event.body);

        await userService.setUserAdminStatus(targetUserId, setAdminStatus === true);
        // TODO: send alarm when this happens: 

        return buildRes(200, { message: 'User admin status updated successfully' });
    } catch (error) {
        console.error('Error updating admin status: ', error);

        const errorId = uuidv4();
        console.error(`Error ID: ${errorId}`, error);

        return buildRes(500, 'Error updating admin status', error);
    }
}

/**
 * Validates if a user has admin privileges and returns admin data
 * This can be used as a specialized login endpoint for admin panel
 */
export async function validateAdmin(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    try {
        // Extract the authenticated user's ID
        const userId = event.requestContext.authorizer?.claims?.sub;
        if (!userId) {
            return buildRes(401, 'Authentication required');
        }

        // Check if user is an admin
        const isAdmin = await permissionService.isUserAdmin(userId);
        if (!isAdmin) {
            return buildRes(403, 'Insufficient privileges: Admin access required');
        }

        // Get full user data
        const user = await userService.getUserById(userId);
        if (!user) {
            return buildRes(404, 'User not found');
        }

        // Return admin-specific data
        return buildRes(200, {
            user: user,
            isAdmin: true,
            // You can add more admin-specific data here if needed
            permissions: ['CREATE_PLACE', 'UPDATE_PLACE', 'DELETE_PLACE', 'MANAGE_USERS']
        });
    } catch (error) {
        console.error('Error validating admin: ', error);
        
        const errorId = uuidv4();
        console.error(`Error ID: ${errorId}`, error);
        
        return buildRes(500, 'Error validating admin status', error);
    }
}

/**
 * Gets the current user's session information
 * This is useful for maintaining sessions across page refreshes
 */
export async function getCurrentSession(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    try {
        // Extract the authenticated user's ID
        const userId = event.requestContext.authorizer?.claims?.sub;
        if (!userId) {
            return buildRes(401, 'Authentication required');
        }

        // Get user data
        const user = await userService.getUserByIdOrUsername(userId);
        if (!user) {
            return buildRes(404, 'User not found');
        }

        // Check if user is an admin
        const isAdmin = await permissionService.isUserAdmin(userId);
        
        // Return session data
        return buildRes(200, {
            user: user,
            isAdmin: isAdmin,
            // Include token details from Cognito claims
            tokenIssuedAt: event.requestContext.authorizer?.claims?.iat,
            tokenExpiresAt: event.requestContext.authorizer?.claims?.exp
        });
    } catch (error) {
        console.error('Error getting current session: ', error);
        
        const errorId = uuidv4();
        console.error(`Error ID: ${errorId}`, error);
        
        return buildRes(500, 'Error getting current session', error);
    }
}

function buildRes(statusCode: number, message: any, error?: any) {
    
    var body: {message: string, error?: string} = {message: ""}
    if (typeof message === 'string') {
        body.message = message
    } else {
        body.message = JSON.stringify(message);
    }
    if (error) {
        body.error = error.errors
    } else {
        // remove the error key if there is no error
        delete body.error
    }
    
    return {
        statusCode: statusCode,
        headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
        },
        
        body: JSON.stringify(body)
    }
}