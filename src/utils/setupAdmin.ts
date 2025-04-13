/**
 * First admin user setup
 * This function is called when the application is first set up to create an admin user.
 * It checks if the user already exists, and if not, creates it with admin privileges.
 * 
 * Get the user pool ID from the environment variable USER_POOL_ID output from the CloudFormation stack.
 * Get the user pool client ID from the environment variable USER_POOL_CLIENT_ID output from the CloudFormation stack.
 * 
 */
import { CognitoIdentityProviderClient, AdminGetUserCommand, AdminUpdateUserAttributesCommand } from '@aws-sdk/client-cognito-identity-provider';
import 'dotenv/config';

async function setupInitialAdmin() {
    const USER_POOL_ID = process.env.USER_POOL_ID;
    const ADMIN_USER_ID = process.env.ADMIN_USER_ID;

    if (!USER_POOL_ID || !ADMIN_USER_ID) {
        console.error('Missing USER_POOL_ID or ADMIN_USER_ID environment variables');
        console.error('Please ensure these variables are set in your .env file or environment');
        console.error('Example usage: USER_POOL_ID=us-east-1_abc123 ADMIN_USER_ID=user-uuid bun run src/utils/setupAdmin.ts');
        process.exit(1);
    }

    const cognitoClient = new CognitoIdentityProviderClient({ region: process.env.AWS_REGION || 'us-east-1' });

    try {
        // First check if the user exists
        try {
            const getUserCommand = new AdminGetUserCommand({
                UserPoolId: USER_POOL_ID,
                Username: ADMIN_USER_ID
            });
            await cognitoClient.send(getUserCommand);
        } catch (error) {
            console.error(`User ${ADMIN_USER_ID} not found in the user pool ${USER_POOL_ID}`);
            console.error('Please make sure the user exists in the Cognito user pool before setting admin privileges');
            process.exit(1);
        }

        // Set the isAdmin attribute to true
        const updateCommand = new AdminUpdateUserAttributesCommand({
            UserPoolId: USER_POOL_ID,
            Username: ADMIN_USER_ID,
            UserAttributes: [
                {
                    Name: 'custom:isAdmin',
                    Value: 'true'
                }
            ]
        });
        await cognitoClient.send(updateCommand);
        console.log(`✅ Admin privileges granted to user: ${ADMIN_USER_ID}`);
        console.log(`User pool: ${USER_POOL_ID}`);

    } catch (error) {
        console.error('Error setting up admin user: ', error);
        process.exit(1);
    }
}

setupInitialAdmin();