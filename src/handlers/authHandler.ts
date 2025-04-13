import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import { CognitoIdentityProviderClient, InitiateAuthCommand, SignUpCommand, ConfirmSignUpCommand, RespondToAuthChallengeCommand } from '@aws-sdk/client-cognito-identity-provider';
import { v4 as uuidv4 } from 'uuid';

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

        // Call Cognito's InitiateAuth API
        const command = new InitiateAuthCommand({
            ClientId: CLIENT_ID,
            AuthFlow: 'USER_PASSWORD_AUTH',
            AuthParameters: {
                USERNAME: username,
                PASSWORD: password,
            },
        });

        const response = await cognitoClient.send(command);

        // Handle NEW_PASSWORD_REQUIRED challenge
        if (response.ChallengeName === 'NEW_PASSWORD_REQUIRED') {
            return buildRes(200, {
                challengeName: 'NEW_PASSWORD_REQUIRED',
                session: response.Session,
                userAttributes: response.ChallengeParameters?.userAttributes,
                requiredAttributes: response.ChallengeParameters?.requiredAttributes,
                userId: response.ChallengeParameters?.USER_ID_FOR_SRP
            });
        }

        // Return the authentication result
        return buildRes(200, {
            tokens: {
                idToken: response.AuthenticationResult?.IdToken,
                accessToken: response.AuthenticationResult?.AccessToken,
                refreshToken: response.AuthenticationResult?.RefreshToken,
                expiresIn: response.AuthenticationResult?.ExpiresIn
            },
            message: 'Login successful'
        });
    } catch (error: any) {
        console.error('Login error:', error);
        
        // Create a unique ID for error tracking
        const errorId = uuidv4();
        console.error(`Error ID: ${errorId}`, error);
        
        // Return appropriate error message
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
 * Handles new password challenge response
 */
export async function respondToNewPasswordChallenge(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    try {
        if (!event.body) {
            return buildRes(400, 'Missing request body');
        }

        const { username, newPassword, session, userAttributes } = JSON.parse(event.body);

        if (!username || !newPassword || !session) {
            return buildRes(400, 'Username, newPassword, and session are required');
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

        // Return the authentication result
        return buildRes(200, {
            tokens: {
                idToken: response.AuthenticationResult?.IdToken,
                accessToken: response.AuthenticationResult?.AccessToken,
                refreshToken: response.AuthenticationResult?.RefreshToken,
                expiresIn: response.AuthenticationResult?.ExpiresIn
            },
            message: 'Password has been updated successfully'
        });
    } catch (error: any) {
        console.error('New password challenge error:', error);
        
        const errorId = uuidv4();
        console.error(`Error ID: ${errorId}`, error);
        
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

function buildRes(statusCode: number, message: any, errorId?: string) {
    let body: { message: any, errorId?: string } = { message };
    
    if (typeof message !== 'string' && typeof message !== 'object') {
        body.message = String(message);
    }
    
    if (errorId) {
        body.errorId = errorId;
    }
    
    return {
        statusCode,
        headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Headers': 'Content-Type,Authorization',
            'Access-Control-Allow-Methods': 'OPTIONS,POST,GET'
        },
        body: JSON.stringify(body)
    };
}