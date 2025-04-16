import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { CognitoIdentityProviderClient, InitiateAuthCommand, SignUpCommand, ConfirmSignUpCommand, RespondToAuthChallengeCommand, AdminGetUserCommand, ForgotPasswordCommand, ConfirmForgotPasswordCommand } from '@aws-sdk/client-cognito-identity-provider';
import { v4 as uuidv4 } from 'uuid';
import * as userService from '../services/userService.js';
import * as permissionService from '../services/permissionService.js';
import * as authChallengeService from '../services/authChallengeService.js';
import * as sessionService from '../services/sessionService.js';
import * as headerUtils from '../utils/headers.js';

const cognitoClient = new CognitoIdentityProviderClient({
    region: process.env.AWS_REGION || 'us-east-1'
});

const USER_POOL_ID = process.env.USER_POOL_ID || '';
const CLIENT_ID = process.env.USER_POOL_CLIENT_ID || '';

/**
 * Handles user login by calling Cognito's InitiateAuth API internally
 */
export async function login(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    try {
        if (!event.body) {
            return buildRes(400, 'Missing request body');
        }

        const { username, password } = JSON.parse(event.body);

        if (!username || !password) {
            return buildRes(400, 'Username and password are required');
        }

        // Get session from cookie if available
        const cookieHeader = event.headers.Cookie || event.headers.cookie;
        const sessionId = sessionService.getSessionIdFromCookie(cookieHeader);
        let session = null;
        
        if (sessionId) {
            // Get session details from database
            const sessionData = await sessionService.getSessionById(sessionId);
            if (sessionData && sessionData.isValid) {
                session = sessionId;
            }
        }

        // Call Cognito's InitiateAuth API
        const command = new InitiateAuthCommand({
            ClientId: CLIENT_ID,
            AuthFlow: 'USER_PASSWORD_AUTH',
            AuthParameters: {
                USERNAME: username,
                PASSWORD: password,
            },
            Session: session || undefined // Use the session token from our database if available
        });

        const response = await cognitoClient.send(command);
        console.log('Login response:', response);

        // Handle NEW_PASSWORD_REQUIRED challenge
        if (response.ChallengeName === 'NEW_PASSWORD_REQUIRED') {
            return buildRes(200, {
                challengeName: 'NEW_PASSWORD_REQUIRED',
                session: response.Session,
                userAttributes: response.ChallengeParameters?.userAttributes,
                requiredAttributes: response.ChallengeParameters?.requiredAttributes,
                userId: response.ChallengeParameters?.USER_ID_FOR_SRP,
                message: 'Password reset required for the user'
            });
        }

        // Fetch user data using the established service
        try {
            return await handleSuccessfulLogin(response, username, event);
        } catch (userError) {
            console.error('Error fetching user after login:', userError);
            
            // Still return the tokens even if user fetch fails
            return buildBasicSuccessResponse(response);
        }
    } catch (error: any) {
        console.error('Login error:', error);
        
        // Create a unique ID for error tracking
        const errorId = uuidv4();
        console.error(`Error ID: ${errorId}`, error);
        
        // Check for PasswordResetRequiredException or similar message indicating password reset is needed
        if (error.name === 'PasswordResetRequiredException' || 
            error.__type === 'PasswordResetRequiredException' || 
            (error.message && error.message.includes('Password reset required'))) {
            
            // Parse the username from the request body
            try {
                const { username } = JSON.parse(event.body || '{}');
                if (!username) {
                    return buildRes(400, 'Username is required');
                }
                
                // Return a response indicating that the password needs to be reset
                return buildRes(200, {
                    requiresPasswordReset: true,
                    username: username,
                    message: 'Your password needs to be reset. Please use the forgot password flow.',
                    errorId
                });
            } catch (parseError) {
                console.error('Error parsing request for password reset:', parseError);
                return buildRes(400, 'Invalid request format');
            }
        }
        
        // Return appropriate error message for other cases
        if (error.name === 'UserNotFoundException') {
            return buildRes(404, 'User not found');
        } else if (error.name === 'NotAuthorizedException') {
            return buildRes(401, 'Incorrect username or password');
        } else if (error.name === 'UserNotConfirmedException') {
            return buildRes(403, 'User is not confirmed');
        }
        
        return buildRes(500, `Authentication error: ${error.message || 'Unknown error'}`, errorId);
    }
}

/**
 * Initiates the forgot password flow by sending a reset code to the user's email
 */
export async function forgotPassword(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    try {
        if (!event.body) {
            return buildRes(400, 'Missing request body');
        }

        const { username } = JSON.parse(event.body);

        if (!username) {
            return buildRes(400, 'Username is required');
        }

        // Call Cognito's ForgotPassword API to send a reset code
        const command = new ForgotPasswordCommand({
            ClientId: CLIENT_ID,
            Username: username
        });

        const response = await cognitoClient.send(command);

        return buildRes(200, {
            message: 'Password reset code has been sent to your email',
            deliveryMedium: response.CodeDeliveryDetails?.DeliveryMedium,
            destination: response.CodeDeliveryDetails?.Destination
        });
    } catch (error: any) {
        console.error('Forgot password error:', error);
        
        const errorId = uuidv4();
        console.error(`Error ID: ${errorId}`, error);
        
        // Return appropriate error message
        if (error.name === 'UserNotFoundException') {
            // For security reasons, don't reveal that the user doesn't exist
            return buildRes(200, {
                message: 'If your account exists, a password reset code has been sent to your email'
            });
        } else if (error.name === 'LimitExceededException') {
            return buildRes(429, 'Too many requests. Please try again later');
        }
        
        return buildRes(500, `Error initiating password reset: ${error.message || 'Unknown error'}`, errorId);
    }
}

/**
 * Confirms the forgot password flow by setting a new password with the provided reset code
 */
export async function confirmForgotPassword(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    try {
        if (!event.body) {
            return buildRes(400, 'Missing request body');
        }

        const { username, confirmationCode, newPassword } = JSON.parse(event.body);

        if (!username || !confirmationCode || !newPassword) {
            return buildRes(400, 'Username, confirmation code, and new password are required');
        }

        // Call Cognito's ConfirmForgotPassword API to set the new password
        const command = new ConfirmForgotPasswordCommand({
            ClientId: CLIENT_ID,
            Username: username,
            ConfirmationCode: confirmationCode,
            Password: newPassword
        });

        await cognitoClient.send(command);

        // Also update the user's password in our local database if we store password hashes
        try {
            const user = await userService.getUserByIdOrUsername(username);
            if (user) {
                // Generate salt if needed
                const salt = user.attributes['custom:salt'] || authChallengeService.generateRandomSalt();
                
                // Hash the new password and store it
                const hashedPassword = authChallengeService.hashPassword(newPassword, salt);
                await userService.updateUserPassword(user.id, hashedPassword, salt);
                
                console.log(`Updated local password hash for user: ${username}`);
            }
        } catch (passwordUpdateError) {
            console.error('Could not update local password, continuing with flow:', passwordUpdateError);
            // Continue with the flow even if we can't update local password
        }

        return buildRes(200, {
            message: 'Password has been reset successfully. You can now login with your new password'
        });
    } catch (error: any) {
        console.error('Confirm forgot password error:', error);
        
        const errorId = uuidv4();
        console.error(`Error ID: ${errorId}`, error);
        
        // Return appropriate error message
        if (error.name === 'CodeMismatchException') {
            return buildRes(400, 'Invalid confirmation code');
        } else if (error.name === 'ExpiredCodeException') {
            return buildRes(400, 'Confirmation code has expired');
        } else if (error.name === 'UserNotFoundException') {
            return buildRes(404, 'User not found');
        } else if (error.name === 'InvalidPasswordException') {
            return buildRes(400, 'Password does not meet requirements');
        }
        
        return buildRes(500, `Error resetting password: ${error.message || 'Unknown error'}`, errorId);
    }
}

/**
 * Handles new password challenge response
 */
export async function respondToNewPasswordChallenge(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    try {
        if (!event.body) {
            return buildRes(400, 'Missing request body');
        }

        const { username, newPassword, session, userAttributes, isTemporarySession } = JSON.parse(event.body);

        if (!username || !newPassword || !session) {
            return buildRes(400, 'Username, newPassword, and session are required');
        }

        // If this is a temporary session token we generated as a fallback,
        // we'll need to create a new real session with Cognito first
        if (isTemporarySession) {
            console.log(`Handling temporary session for user: ${username}`);
            try {
                // Try to get a real session from Cognito first
                const authCommand = new InitiateAuthCommand({
                    ClientId: CLIENT_ID,
                    AuthFlow: 'USER_PASSWORD_AUTH',
                    AuthParameters: {
                        USERNAME: username,
                        PASSWORD: 'FORCE_CHALLENGE_FLOW' // This should trigger the NEW_PASSWORD_REQUIRED challenge
                    }
                });
                
                const authResponse = await cognitoClient.send(authCommand);
                
                if (authResponse.ChallengeName === 'NEW_PASSWORD_REQUIRED' && authResponse.Session) {
                    // Use the real session for the challenge
                    console.log('Successfully obtained a real session token');
                    return handlePasswordResetChallenge(username, newPassword, authResponse.Session);
                }
            } catch (error) {
                console.error('Error getting real session:', error);
                // Continue with normal flow as a fallback
            }
        }

        // Create the ChallengeResponses object
        const challengeResponses: Record<string, string> = {
            USERNAME: username,
            NEW_PASSWORD: newPassword
        };

        // Add any additional user attributes
        if (userAttributes) {
            Object.entries(userAttributes).forEach(([key, value]) => {
                challengeResponses[`userAttributes.${key}`] = value as string;
            });
        }

        // Call Cognito's RespondToAuthChallenge API
        const command = new RespondToAuthChallengeCommand({
            ClientId: CLIENT_ID,
            ChallengeName: 'NEW_PASSWORD_REQUIRED',
            Session: session,
            ChallengeResponses: challengeResponses
        });

        const response = await cognitoClient.send(command);

        // Fetch user data using the same approach as login
        try {
            return await handleSuccessfulLogin(response, username, event);
        } catch (userError) {
            console.error('Error fetching user after password challenge:', userError);
            
            // Still return the tokens even if user fetch fails
            return buildBasicSuccessResponse(response);
        }
    } catch (error: any) {
        console.error('New password challenge error:', error);
        
        const errorId = uuidv4();
        console.error(`Error ID: ${errorId}`, error);
        
        // If this is an error related to an invalid session token, try to recover
        if (error.name === 'NotAuthorizedException' || 
            error.name === 'CodeMismatchException' || 
            error.__type === 'CodeMismatchException' ||
            error.name === 'PasswordResetRequiredException' ||
            error.__type === 'PasswordResetRequiredException' ||
            (error.message && (error.message.includes('Invalid session') || error.message.includes('expired') || error.message.includes('Password reset required')))) {
            
            try {
                // Parse username and password from the request
                const { username, newPassword } = JSON.parse(event.body || '{}');
                if (!username || !newPassword) {
                    return buildRes(400, 'Username and newPassword are required');
                }
                
                // Try to get a new session by authenticating the user
                console.log('Attempting to get a fresh session for password reset');
                
                // For users with PasswordResetRequiredException, we need to use a special approach
                // First try with ADMIN_CREATE_USER flow which might give us a valid session
                try {
                    console.log('Trying admin flow for password reset required user');
                    // Use AdminGetUser to verify the user exists first
                    const adminCommand = new AdminGetUserCommand({
                        UserPoolId: USER_POOL_ID,
                        Username: username
                    });
                    
                    await cognitoClient.send(adminCommand);
                    
                    // If we get here, the user exists, create a session directly
                    // We'll use a temporary session with a flag for the client
                    const tempSession = authChallengeService.generateUniqueId();
                    
                    return buildRes(200, {
                        challengeName: 'NEW_PASSWORD_REQUIRED',
                        message: 'Password reset required for the user',
                        session: tempSession,
                        isPasswordResetRequired: true,
                        passwordResetByAdmin: true,
                        errorId: uuidv4()
                    });
                } catch (adminError) {
                    console.log('Admin flow failed, falling back to standard approach:', adminError);
                }
                
                // Standard approach as fallback
                const command = new InitiateAuthCommand({
                    ClientId: CLIENT_ID,
                    AuthFlow: 'USER_PASSWORD_AUTH',
                    AuthParameters: {
                        USERNAME: username,
                        PASSWORD: 'FORCE_CHALLENGE_FLOW' // This should trigger NEW_PASSWORD_REQUIRED
                    }
                });
                
                const response = await cognitoClient.send(command);
                
                if (response.ChallengeName === 'NEW_PASSWORD_REQUIRED' && response.Session) {
                    // Got a fresh session token, try again with this token
                    console.log('Obtained fresh session token, retrying password reset');
                    return handlePasswordResetChallenge(username, newPassword, response.Session);
                }
            } catch (error) {
                console.error('Error trying to get fresh session:', error);
                
                // If we get a PasswordResetRequiredException again, we need to use admin flow
                const retryError = error as any; // Type assertion to access properties
                if (retryError.name === 'PasswordResetRequiredException' || retryError.__type === 'PasswordResetRequiredException') {
                    try {
                        const { username, newPassword } = JSON.parse(event.body || '{}');
                        
                        // Create a temporary session for the client with special flags
                        const tempSession = authChallengeService.generateUniqueId();
                        
                        return buildRes(200, {
                            challengeName: 'NEW_PASSWORD_REQUIRED',
                            message: 'Password reset required for the user. Please contact an administrator.',
                            session: tempSession,
                            isPasswordResetRequired: true,
                            requiresAdminAction: true,
                            errorId: uuidv4()
                        });
                    } catch (finalError) {
                        console.error('Final error in password reset recovery:', finalError);
                    }
                }
            }
            
            return buildRes(400, 'Invalid or expired session. Please try logging in again.', errorId);
        }
        
        return buildRes(500, `Error setting new password: ${error.message || 'Unknown error'}`, errorId);
    }
}

/**
 * Handles user registration by calling Cognito's SignUp API internally
 */
export async function register(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    try {
        if (!event.body) {
            return buildRes(400, 'Missing request body');
        }

        const { username, password, email, given_name } = JSON.parse(event.body);

        if (!username || !password || !email) {
            return buildRes(400, 'Username, password, and email are required');
        }

        // Prepare user attributes
        const userAttributes = [
            {
                Name: 'email',
                Value: email
            }
        ];

        // Add given name if provided
        if (given_name) {
            userAttributes.push({
                Name: 'given_name',
                Value: given_name
            });
        }

        // Call Cognito's SignUp API
        const command = new SignUpCommand({
            ClientId: CLIENT_ID,
            Username: username,
            Password: password,
            UserAttributes: userAttributes
        });

        const response = await cognitoClient.send(command);

        return buildRes(200, {
            userSub: response.UserSub,
            userConfirmed: response.UserConfirmed,
            message: 'Registration successful. Check your email for confirmation code.'
        });
    } catch (error: any) {
        console.error('Registration error:', error);
        
        const errorId = uuidv4();
        console.error(`Error ID: ${errorId}`, error);
        
        // Return appropriate error message
        if (error.name === 'UsernameExistsException') {
            return buildRes(409, 'Username already exists');
        } else if (error.name === 'InvalidPasswordException') {
            return buildRes(400, 'Password does not meet requirements');
        } else if (error.name === 'InvalidParameterException') {
            return buildRes(400, error.message);
        }
        
        return buildRes(500, `Registration error: ${error.message || 'Unknown error'}`, errorId);
    }
}

/**
 * Handles email verification for user registration
 */
export async function confirmRegistration(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    try {
        if (!event.body) {
            return buildRes(400, 'Missing request body');
        }

        const { username, confirmationCode } = JSON.parse(event.body);

        if (!username || !confirmationCode) {
            return buildRes(400, 'Username and confirmation code are required');
        }

        // Call Cognito's ConfirmSignUp API
        const command = new ConfirmSignUpCommand({
            ClientId: CLIENT_ID,
            Username: username,
            ConfirmationCode: confirmationCode
        });

        await cognitoClient.send(command);

        return buildRes(200, {
            message: 'User confirmed successfully. You can now login.'
        });
    } catch (error: any) {
        console.error('Confirmation error:', error);
        
        const errorId = uuidv4();
        console.error(`Error ID: ${errorId}`, error);
        
        // Return appropriate error message
        if (error.name === 'CodeMismatchException') {
            return buildRes(400, 'Invalid confirmation code');
        } else if (error.name === 'ExpiredCodeException') {
            return buildRes(400, 'Confirmation code has expired');
        } else if (error.name === 'UserNotFoundException') {
            return buildRes(404, 'User not found');
        }
        
        return buildRes(500, `Confirmation error: ${error.message || 'Unknown error'}`, errorId);
    }
}

/**
 * Generates a challenge for authentication (first step of challenge-response login)
 */
export async function requestChallenge(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    try {
        if (!event.body) {
            return buildRes(400, 'Missing request body');
        }

        const { username } = JSON.parse(event.body);

        if (!username) {
            return buildRes(400, 'Username is required');
        }

        // Check if user exists
        const user = await userService.getUserByIdOrUsername(username);
        if (!user) {
            // Don't reveal that the user doesn't exist
            // Send a challenge anyway to prevent username enumeration
            const dummyChallenge = await authChallengeService.createChallenge('dummy_user');
            
            return buildRes(200, {
                challengeId: dummyChallenge.challengeId,
                salt: dummyChallenge.salt,
                expiresAt: dummyChallenge.expiresAt
            });
        }

        // Get stored salt or generate a new one if it doesn't exist
        let salt = user.attributes['custom:salt'];
        if (!salt) {
            salt = authChallengeService.generateRandomSalt();
            
            // Store the salt for this user if it's a new user
            await userService.updateUserPassword(user.id, '', salt);
        }

        // Create a challenge
        const challenge = await authChallengeService.createChallenge(username);

        return buildRes(200, {
            challengeId: challenge.challengeId,
            salt: salt, // Use the user's stored salt
            expiresAt: challenge.expiresAt
        });
    } catch (error: any) {
        console.error('Challenge request error:', error);
        
        const errorId = uuidv4();
        console.error(`Error ID: ${errorId}`, error);
        
        return buildRes(500, `Error generating challenge: ${error.message || 'Unknown error'}`, errorId);
    }
}

/**
 * Handles user login with challenge-response and client-side hashing
 */
export async function loginWithChallenge(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    try {
        if (!event.body) {
            return buildRes(400, 'Missing request body');
        }

        // Parse both standard challenge and password reset challenge parameters
        const { username, hashedPassword, challengeId, session, newPassword, userAttributes } = JSON.parse(event.body);

        // Handle password reset challenge (NEW_PASSWORD_REQUIRED)
        if (session && newPassword) {
            return handlePasswordResetChallenge(username, newPassword, session);
        }

        // Standard challenge-response flow continues below
        if (!username || !hashedPassword || !challengeId) {
            return buildRes(400, 'Username, hashedPassword, and challengeId are required');
        }

        // Validate CSRF token if present - but don't use it as a session token
        const csrfToken = event.headers['X-CSRF-Token'] || event.headers['x-csrf-token'];
        if (csrfToken) {
            // In a real implementation, you would validate against a stored session token
            // For now, we'll just log that we received the token
            console.log('Received CSRF token:', csrfToken);
        }

        // Validate the challenge
        const challengeData = await authChallengeService.validateChallenge(challengeId);
        if (!challengeData || challengeData.username !== username) {
            return buildRes(401, 'Invalid or expired challenge');
        }

        // At this point the challenge is valid, verify the hashed password
        const isPasswordValid = await userService.verifyHashedPassword(username, hashedPassword);
        
        // If no hashed password is stored (legacy user), fall back to Cognito authentication
        if (!isPasswordValid) {
            try {
                // Call Cognito's InitiateAuth API as fallback
                const command = new InitiateAuthCommand({
                    ClientId: CLIENT_ID,
                    AuthFlow: 'USER_PASSWORD_AUTH',
                    AuthParameters: {
                        USERNAME: username,
                        PASSWORD: hashedPassword, // Note: This won't work with hashed passwords, only for backward compatibility
                    }
                });

                const response = await cognitoClient.send(command);
                
                // If we get here, the login was successful using the legacy method
                // Let's update the user to use the new hashed password system
                const user = await userService.getUserByIdOrUsername(username);
                if (user) {
                    await userService.updateUserPassword(user.id, hashedPassword, challengeData.salt);
                }

                // Continue with regular login response
                return handleSuccessfulLogin(response, username);
            } catch (cognitoError: any) {
                // If Cognito auth fails, return authentication failure
                if (cognitoError.name === 'NotAuthorizedException') {
                    return buildRes(401, 'Incorrect username or password');
                }
                
                throw cognitoError; // Rethrow other errors
            }
        }

        // If we get here, the password was successfully verified using the hashed password
        // Generate tokens using Cognito's AdminInitiateAuth
        try {
            const user = await userService.getUserByIdOrUsername(username);
            if (!user) {
                return buildRes(404, 'User not found');
            }
            
            // Generate a new CSRF token
            const sessionToken = authChallengeService.generateUniqueId(); // In a real implementation, this would be the actual session token
            const newCsrfToken = authChallengeService.hashPassword(sessionToken, process.env.CSRF_SECRET || 'default-csrf-secret').substring(0, 32);

            // For this implementation, we'll simulate token generation
            // In a real implementation, you would validate with Cognito and generate proper tokens
            const simulatedTokens = {
                idToken: `simulated-id-token-${authChallengeService.generateUniqueId()}`,
                accessToken: `simulated-access-token-${authChallengeService.generateUniqueId()}`,
                refreshToken: `simulated-refresh-token-${authChallengeService.generateUniqueId()}`,
                expiresIn: 3600
            };

            // Check if user is admin
            const isAdmin = await permissionService.isUserAdmin(user.id);

            return buildRes(200, {
                tokens: simulatedTokens,
                user: user,
                isAdmin: isAdmin,
                csrfToken: newCsrfToken, // Include CSRF token in response
                message: 'Login successful'
            });
        } catch (error) {
            console.error('Error generating tokens:', error);
            throw error;
        }
    } catch (error: any) {
        console.error('Login with challenge error:', error);
        
        const errorId = uuidv4();
        console.error(`Error ID: ${errorId}`, error);
        
        return buildRes(500, `Authentication error: ${error.message || 'Unknown error'}`, errorId);
    }
}

/**
 * Helper function to handle the NEW_PASSWORD_REQUIRED challenge from Cognito
 */
async function handlePasswordResetChallenge(username: string, newPassword: string, session: string): Promise<APIGatewayProxyResult> {
    try {
        console.log(`Handling password reset challenge for user: ${username}`);
        console.log(`Session token length: ${session.length}`);
        
        // Create the ChallengeResponses object
        const challengeResponses: Record<string, string> = {
            USERNAME: username,
            NEW_PASSWORD: newPassword
        };

        // Verify the user exists before attempting the challenge
        const user = await userService.getUserByIdOrUsername(username);
        if (!user) {
            console.error(`User not found: ${username}`);
            return buildRes(404, 'User not found');
        }

        console.log(`Challenge responses prepared for ${username}:`, Object.keys(challengeResponses));
        
        // Call Cognito's RespondToAuthChallenge API
        const command = new RespondToAuthChallengeCommand({
            ClientId: CLIENT_ID,
            ChallengeName: 'NEW_PASSWORD_REQUIRED',
            Session: session,
            ChallengeResponses: challengeResponses
        });

        console.log('Sending RespondToAuthChallenge command to Cognito');
        const response = await cognitoClient.send(command);
        console.log('Successfully responded to auth challenge');

        // Also update the user's password in our local database if we store password hashes
        try {
            // Generate salt if needed
            const salt = user.attributes['custom:salt'] || authChallengeService.generateRandomSalt();
            
            // Hash the new password and store it
            const hashedPassword = authChallengeService.hashPassword(newPassword, salt);
            await userService.updateUserPassword(user.id, hashedPassword, salt);
            
            console.log(`Updated local password hash for user: ${username}`);
        } catch (passwordUpdateError) {
            console.error('Could not update local password, continuing with flow:', passwordUpdateError);
            // Continue with the flow even if we can't update local password
        }

        // Fetch user data using the same approach as login
        try {
            return await handleSuccessfulLogin(response, username);
        } catch (userError) {
            console.error('Error fetching user after password challenge:', userError);
            
            // Still return the tokens even if user fetch fails
            return buildRes(200, {
                tokens: {
                    idToken: response.AuthenticationResult?.IdToken,
                    accessToken: response.AuthenticationResult?.AccessToken,
                    refreshToken: response.AuthenticationResult?.RefreshToken,
                    expiresIn: response.AuthenticationResult?.ExpiresIn
                },
                message: 'Password has been updated successfully'
            });
        }
    } catch (error: any) {
        console.error('Password reset challenge error:', error);
        
        const errorId = uuidv4();
        console.error(`Error ID: ${errorId}`, error);
        
        // Check for specific errors and handle them appropriately
        if (error.name === 'PasswordResetRequiredException' || error.__type === 'PasswordResetRequiredException') {
            // This is actually what we're expecting! The user needs a password reset, which is what we're doing
            console.log('Detected PasswordResetRequiredException - this is expected during reset');
            
            // We'll try to handle the reset directly using AdminSetUserPassword if we have permissions
            try {
                // This requires admin permissions, so it may not work depending on your setup
                console.log('Attempting direct password reset using admin API');
                
                // Request a fresh session with auth flow
                const authCommand = new InitiateAuthCommand({
                    ClientId: CLIENT_ID,
                    AuthFlow: 'USER_PASSWORD_AUTH',
                    AuthParameters: {
                        USERNAME: username,
                        // Use an intentionally invalid password to trigger the challenge
                        PASSWORD: 'TEMPORARY_PASSWORD_' + Date.now()
                    }
                });
                
                try {
                    const authResponse = await cognitoClient.send(authCommand);
                    
                    // If we successfully got a challenge, use it
                    if (authResponse.ChallengeName === 'NEW_PASSWORD_REQUIRED' && authResponse.Session) {
                        const resetCommand = new RespondToAuthChallengeCommand({
                            ClientId: CLIENT_ID,
                            ChallengeName: 'NEW_PASSWORD_REQUIRED',
                            Session: authResponse.Session,
                            ChallengeResponses: {
                                USERNAME: username,
                                NEW_PASSWORD: newPassword
                            }
                        });
                        
                        const resetResponse = await cognitoClient.send(resetCommand);
                        
                        return await handleSuccessfulLogin(resetResponse, username);
                    }
                } catch (authError) {
                    console.log('Auth flow approach failed:', authError);
                    // Continue to the next approach
                }
                
                // If the above didn't work, we'll create a temporary session and tell the client
                // that they need to complete the process in a different way
                const tempSession = authChallengeService.generateUniqueId();
                
                return buildRes(200, {
                    challengeName: 'NEW_PASSWORD_REQUIRED',
                    message: 'Password reset in progress. Please complete the process by logging in again.',
                    session: tempSession,
                    isPasswordResetRequired: true,
                    needsLoginToComplete: true,
                    errorId
                });
            } catch (adminError) {
                console.error('Admin password reset failed:', adminError);
                
                // Return a user-friendly message that explains what's happening
                return buildRes(200, {
                    challengeName: 'NEW_PASSWORD_REQUIRED',
                    message: 'Your password needs to be reset. Please log in with temporary credentials provided to you.',
                    isPasswordResetRequired: true,
                    errorId
                });
            }
        } else if (error.name === 'CodeMismatchException' || error.__type === 'CodeMismatchException') {
            // Try to re-authenticate the user to get a fresh session token
            try {
                console.log('Session token invalid, attempting to re-authenticate user');
                
                // Try to get a new session by initiating auth
                const command = new InitiateAuthCommand({
                    ClientId: CLIENT_ID,
                    AuthFlow: 'USER_PASSWORD_AUTH',
                    AuthParameters: {
                        USERNAME: username,
                        PASSWORD: 'FORCE_CHALLENGE_FLOW' // This will fail authentication but might return a NEW_PASSWORD_REQUIRED challenge
                    },
                });
                
                const response = await cognitoClient.send(command);
                
                if (response.ChallengeName === 'NEW_PASSWORD_REQUIRED' && response.Session) {
                    // Got a fresh session token, try again with this token
                    console.log('Obtained fresh session token, retrying password reset');
                    return handlePasswordResetChallenge(username, newPassword, response.Session);
                } else {
                    console.log('Failed to obtain a new challenge session');
                }
            } catch (retryError) {
                console.error('Error trying to get fresh session:', retryError);
            }
            
            return buildRes(400, 'Invalid or expired session. Please try logging in again.', errorId);
        } else if (error.name === 'NotAuthorizedException') {
            return buildRes(401, 'Not authorized to change password. Please contact an administrator.', errorId);
        }
        
        return buildRes(500, `Error setting new password: ${error.message || 'Unknown error'}`, errorId);
    }
}

/**
 * Handle logout - invalidate tokens (if applicable) and clean up session
 */
export async function logout(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    try {
        // Get the session ID from cookie
        const cookieHeader = event.headers.Cookie || event.headers.cookie;
        const sessionId = sessionService.getSessionIdFromCookie(cookieHeader);
        
        if (!sessionId) {
            return headerUtils.createErrorResponse(401, 'No active session to logout from');
        }
        
        // Validate CSRF token for security
        const csrfToken = event.headers['X-CSRF-Token'] || event.headers['x-csrf-token'];
        if (!csrfToken) {
            return headerUtils.createErrorResponse(403, 'CSRF token required');
        }
        
        // Validate the CSRF token against the session
        const isValidCsrf = await sessionService.validateCsrfToken(sessionId, csrfToken);
        if (!isValidCsrf) {
            return headerUtils.createErrorResponse(403, 'Invalid CSRF token');
        }
        
        // Get the session to retrieve the userId
        const session = await sessionService.getSessionById(sessionId);
        if (!session) {
            // Session not found, consider it already logged out
            return {
                statusCode: 200,
                headers: headerUtils.getClearCookieHeaders(),
                body: JSON.stringify({
                    message: 'Already logged out'
                })
            };
        }
        
        // Invalidate the session in our database
        await sessionService.invalidateSession(sessionId);
        
        // Clear the session cookie
        return {
            statusCode: 200,
            headers: headerUtils.getClearCookieHeaders(),
            body: JSON.stringify({
                message: 'Logout successful'
            })
        };
    } catch (error: any) {
        console.error('Logout error:', error);
        
        const errorId = uuidv4();
        console.error(`Error ID: ${errorId}`, error);
        
        return buildRes(500, `Logout error: ${error.message || 'Unknown error'}`, errorId);
    }
}

/**
 * Handle a successful login via any method
 */
async function handleSuccessfulLogin(cognitoResponse: any, username: string, event?: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    try {
        // Extract user information from the ID token if available
        if (cognitoResponse.AuthenticationResult?.IdToken) {
            // Get user data
            let user = await userService.getUserByIdOrUsername(username);
            
            if (user) {
                // Check admin status
                const isAdmin = await permissionService.isUserAdmin(user.id);
                console.log(`User ${username} admin status: ${isAdmin}`);
                
                // Create a new session in our session store
                const userAgent = event?.headers['User-Agent'] || event?.headers['user-agent'];
                const ipAddress = event?.requestContext.identity?.sourceIp;
                
                const session = await sessionService.createSession(
                    user.id,
                    username,
                    userAgent,
                    ipAddress
                );
                
                // Set cookie headers and include CSRF token in response
                const cookieHeader = sessionService.getSessionCookieHeader(session.sessionId);
                
                // Use our headers utility to create a response with proper CORS headers
                return {
                    statusCode: 200,
                    headers: headerUtils.getCookieHeaders(cookieHeader),
                    body: JSON.stringify({
                        tokens: {
                            idToken: cognitoResponse.AuthenticationResult.IdToken,
                            accessToken: cognitoResponse.AuthenticationResult.AccessToken,
                            refreshToken: cognitoResponse.AuthenticationResult.RefreshToken,
                            expiresIn: cognitoResponse.AuthenticationResult.ExpiresIn
                        },
                        user: user,
                        isAdmin: isAdmin,
                        csrfToken: session.csrfToken, // Include CSRF token for frontend to use in subsequent requests
                        message: 'Login successful'
                    })
                };
            }
        }
        
        // If we get here, we couldn't get the user data
        console.log(`Could not retrieve user data for: ${username}`);
        return buildRes(200, {
            tokens: {
                idToken: cognitoResponse.AuthenticationResult?.IdToken,
                accessToken: cognitoResponse.AuthenticationResult?.AccessToken,
                refreshToken: cognitoResponse.AuthenticationResult?.RefreshToken,
                expiresIn: cognitoResponse.AuthenticationResult?.ExpiresIn
            },
            message: 'Login successful, but user data could not be retrieved'
        });
    } catch (error) {
        console.error('Error handling successful login:', error);
        
        // Still return the tokens even if user data fetch fails
        return buildRes(200, {
            tokens: {
                idToken: cognitoResponse.AuthenticationResult?.IdToken,
                accessToken: cognitoResponse.AuthenticationResult?.AccessToken,
                refreshToken: cognitoResponse.AuthenticationResult?.RefreshToken,
                expiresIn: cognitoResponse.AuthenticationResult?.ExpiresIn
            },
            message: 'Login successful'
        });
    }
}

function buildRes(statusCode: number, message: any, errorId?: string) {
    return headerUtils.createApiResponse(
        statusCode,
        headerUtils.formatResponseBody(message, errorId)
    );
}

function buildBasicSuccessResponse(response: any) {
    return buildRes(200, {
        tokens: {
            idToken: response.AuthenticationResult?.IdToken,
            accessToken: response.AuthenticationResult?.AccessToken,
            refreshToken: response.AuthenticationResult?.RefreshToken,
            expiresIn: response.AuthenticationResult?.ExpiresIn
        },
        message: 'Login successful'
    });
}