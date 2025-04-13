import { CognitoIdentityProviderClient, AdminGetUserCommand, AdminUpdateUserAttributesCommand, ListUsersCommand } from "@aws-sdk/client-cognito-identity-provider";
const cognitoClient = new CognitoIdentityProviderClient({ 
    region: process.env.AWS_REGION || 'us-east-1' 
});

const USER_POOL_ID = process.env.USER_POOL_ID || '';

export async function getUserById(userId: string) {
    console.log('getting user by id', userId);
    try {
        console.log(`[getUserById] Fetching user with ID: ${userId}`);
        const command = new AdminGetUserCommand({
            UserPoolId: USER_POOL_ID,
            Username: userId
        });
        
        const response = await cognitoClient.send(command);
        console.log(`[getUserById] Response:`, response);
        // Convert the Cognito user format to a more friendly format
        const user = {
            id: userId,
            username: response.Username,
            attributes: {} as Record<string, string>
        };
        
        if (response.UserAttributes) {
            for (const attr of response.UserAttributes) {
                if (attr.Name && attr.Value) {
                    user.attributes[attr.Name] = attr.Value;
                }
            }
        }
        
        return user;
    } catch (error) {
        console.error('Error fetching user from Cognito:', error);
        return null;
    }
}

export async function getUserByIdOrUsername(identifier: string) {
    try {
        console.log(`Looking up user by identifier: ${identifier}`);
        // First try direct lookup (assuming identifier is username)
        try {
            const command = new AdminGetUserCommand({
                UserPoolId: USER_POOL_ID,
                Username: identifier
            });
            
            const response = await cognitoClient.send(command);
            console.log(`Found user by username: ${identifier}`);
            // Format and return user...
            return formatCognitoUser(response, identifier);
        } catch (error: any) {
            // If not found, try to find by sub
            if (error.name === 'UserNotFoundException') {
                console.log(`Username lookup failed, trying UUID lookup for: ${identifier}`);
                
                // Try finding by UUID pattern
                if (/^[0-9a-f-]+$/.test(identifier)) {
                    const listUsersCommand = new ListUsersCommand({
                        UserPoolId: USER_POOL_ID,
                        Filter: `sub = "${identifier}"`
                    });
                    
                    const listUsersResponse = await cognitoClient.send(listUsersCommand);
                    
                    if (listUsersResponse.Users && listUsersResponse.Users.length > 0) {
                        console.log(`Found user by UUID: ${identifier}`);
                        return formatCognitoUser(listUsersResponse.Users[0], identifier);
                    }
                    
                    console.log(`No user found by UUID: ${identifier}`);
                    return null;
                }
                
                console.log(`Identifier isn't a UUID pattern: ${identifier}`);
                return null;
            }
            throw error;
        }
    } catch (error) {
        console.error('Error fetching user from Cognito:', error);
        return null;
    }
}

export async function updateUser(userId: string, userData: any) {
    try {
        // Convert userData to Cognito user attributes format
        const userAttributes = [];
        
        for (const [key, value] of Object.entries(userData)) {
            // Skip fields that can't be updated or require special handling
            if (key !== 'password' && key !== 'username') {
                userAttributes.push({
                    Name: key,
                    Value: value as string
                });
            }
        }
        
        const command = new AdminUpdateUserAttributesCommand({
            UserPoolId: USER_POOL_ID,
            Username: userId,
            UserAttributes: userAttributes
        });
        
        await cognitoClient.send(command);
        
        // Fetch the updated user
        return getUserById(userId);
    } catch (error) {
        console.error('Error updating user in Cognito:', error);
        throw error;
    }
}

/**
 * Set admin status for a user 
 */
export async function setUserAdminStatus(userId: string, isAdmin: boolean): Promise<void> {
    try {
        const command = new AdminUpdateUserAttributesCommand({
            UserPoolId: USER_POOL_ID,
            Username: userId,
            UserAttributes: [
                {
                    Name: 'custom:isAdmin',
                    Value: isAdmin ? 'true' : 'false'
                }
            ]
        });

        await cognitoClient.send(command);
        console.log(`User ${userId} admin status set to ${isAdmin}`);
    } catch (error) {
        console.error('Error updating user admin status: ', error);
        throw error;
    }
}

/**
 * Helper function to format the Cognito user response into a more friendly format
 */
function formatCognitoUser(cognitoUser: any, identifier: string) {
    const user = {
        id: identifier,
        username: cognitoUser.Username,
        attributes: {} as Record<string, string>
    };
    
    if (cognitoUser.UserAttributes) {
        for (const attr of cognitoUser.UserAttributes) {
            if (attr.Name && attr.Value) {
                user.attributes[attr.Name] = attr.Value;
            }
        }
    }
    
    return user;
}
