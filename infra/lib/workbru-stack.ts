import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as path from 'path';

export class WorkbruStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props);

        // DynamoDB table for places
        const placesTable = new dynamodb.Table(this, 'PlacesTable', {
            partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING},
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            removalPolicy: cdk.RemovalPolicy.RETAIN,
        });

        // DynamoDB table for authentication challenges
        const challengesTable = new dynamodb.Table(this, 'AuthChallengesTable', {
            partitionKey: { name: 'challengeId', type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            removalPolicy: cdk.RemovalPolicy.DESTROY, // Challenges are ephemeral
            timeToLiveAttribute: 'expiresAt', // TTL based on challenge expiration
        });

        // DynamoDB table for user sessions
        const sessionsTable = new dynamodb.Table(this, 'SessionsTable', {
            partitionKey: { name: 'sessionId', type: dynamodb.AttributeType.STRING },
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            removalPolicy: cdk.RemovalPolicy.DESTROY, // Sessions can be recreated
            timeToLiveAttribute: 'expiresAt', // TTL for automatic cleanup of expired sessions
        });

        // Add GSI for querying sessions by userId
        sessionsTable.addGlobalSecondaryIndex({
            indexName: 'userId-index',
            partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
            projectionType: dynamodb.ProjectionType.ALL
        });

        // Create a Secret in AWS Secrets Manager for application secrets
        const appSecrets = new secretsmanager.Secret(this, 'WorkbruAppSecrets', {
            secretName: 'WorkbruAppSecrets',
            description: 'Secrets for Workbru application',
            generateSecretString: {
                secretStringTemplate: JSON.stringify({
                    // Empty object to be filled with our secrets
                }),
                generateStringKey: 'CSRF_SECRET',  // This generates a secure random string
                excludeCharacters: '/@"\'\\'      // Exclude problematic characters
            }
        });

        // Add additional secrets if needed
        const secretsTemplate = {
            CSRF_SECRET: appSecrets.secretValueFromJson('CSRF_SECRET').toString(),
            // Add other secrets as needed in the future
        };

        // For local development, use a dummy secret
        const csrfSecretValue = process.env.NODE_ENV === 'production' 
            ? appSecrets.secretValueFromJson('CSRF_SECRET').toString() 
            : 'local-development-csrf-secret';

        // Create a GSI for location-based queries
        // placesTable.addGlobalSecondaryIndex({
        //     indexName: 'geohash-prefix-index',
        //     partitionKey: { name: 'geohashPrefix', type: dynamodb.AttributeType.STRING },
        //     sortKey: {name: 'geohash', type: dynamodb.AttributeType.STRING },
        //     projectionType: dynamodb.ProjectionType.ALL,
        // });

        // First keep both indexes
        // placesTable.addGlobalSecondaryIndex({
        //     indexName: 'geohash-index',  // Keep the old one
        //     partitionKey: { name: 'geohash', type: dynamodb.AttributeType.STRING },
        //     projectionType: dynamodb.ProjectionType.ALL,
        // });

        // Add the new one
        placesTable.addGlobalSecondaryIndex({
            indexName: 'geohash-prefix-index',
            partitionKey: { name: 'geohashPrefix', type: dynamodb.AttributeType.STRING },
            sortKey: {name: 'geohash', type: dynamodb.AttributeType.STRING },
            projectionType: dynamodb.ProjectionType.ALL,
        });

        // S3 bucket for photos and other assets
        const assetsBucket = new s3.Bucket(this, 'WorkbruAssets', {
            cors: [
                {
                    allowedMethods: [
                        s3.HttpMethods.GET,
                        s3.HttpMethods.PUT,
                        s3.HttpMethods.POST,
                    ],
                    allowedOrigins: ['*'],
                    allowedHeaders: ['*'],
                },
            ],
            removalPolicy: cdk.RemovalPolicy.RETAIN,
            blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
        });

        // cognito user pools 
        const userPool = new cognito.UserPool(this, 'WorkbruUserPoolV2', {
            selfSignUpEnabled: true,
            autoVerify: { email: true },
            standardAttributes: {
                email: {
                    required: true,
                    mutable: true,
                },
                givenName: {
                    required: true,
                    mutable: true,
                },
            },
            customAttributes: {
                isAdmin: new cognito.StringAttribute({ mutable: true }), // custom attr for admin
                hashedPassword: new cognito.StringAttribute({ mutable: true }), // for storing hashed passwords
                salt: new cognito.StringAttribute({ mutable: true }), // for storing password salt
            },
            passwordPolicy: {
                minLength: 8,
                requireLowercase: true,
                requireUppercase: true,
                requireDigits: true,
                requireSymbols: false,
            },
            accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
            removalPolicy: cdk.RemovalPolicy.DESTROY, // Change to RETAIN in production
        });

        // create a user pool client
        const userPoolClient = new cognito.UserPoolClient(this, 'WorkbruUserPoolClient', {
            userPool,
            authFlows: {
                userPassword: true,
                userSrp: true,
            },
            generateSecret: false,
        });

        // create a cognito authorizer for api gateway
        const authorizer = new apigateway.CognitoUserPoolsAuthorizer(this, 'WorkbruAuthorizer', {
            cognitoUserPools: [userPool],
        });

        console.log(path.join(__dirname, '../../dist'));

        // Lambda functions for authentication
        const loginFunction = new lambda.Function(this, 'LoginFunction', {
            runtime: lambda.Runtime.NODEJS_20_X,
            handler: 'index.login',
            code: lambda.Code.fromAsset(path.join(__dirname, '../../dist')),
            environment: {
                USER_POOL_ID: userPool.userPoolId,
                USER_POOL_CLIENT_ID: userPoolClient.userPoolClientId,
                NODE_ENV: 'production',
                SESSION_TABLE: sessionsTable.tableName,
                CSRF_SECRET: csrfSecretValue
            }
        });

        const registerFunction = new lambda.Function(this, 'RegisterFunction', {
            runtime: lambda.Runtime.NODEJS_20_X,
            handler: 'index.register',
            code: lambda.Code.fromAsset(path.join(__dirname, '../../dist')),
            environment: {
                USER_POOL_ID: userPool.userPoolId,
                USER_POOL_CLIENT_ID: userPoolClient.userPoolClientId,
                NODE_ENV: 'production',
                SESSION_TABLE: sessionsTable.tableName,
                CSRF_SECRET: csrfSecretValue
            }
        });

        const confirmRegistrationFunction = new lambda.Function(this, 'ConfirmRegistrationFunction', {
            runtime: lambda.Runtime.NODEJS_20_X,
            handler: 'index.confirmRegistration',
            code: lambda.Code.fromAsset(path.join(__dirname, '../../dist')),
            environment: {
                USER_POOL_ID: userPool.userPoolId,
                USER_POOL_CLIENT_ID: userPoolClient.userPoolClientId,
                NODE_ENV: 'production',
                SESSION_TABLE: sessionsTable.tableName,
                CSRF_SECRET: csrfSecretValue
            }
        });

        const respondToNewPasswordChallengeFunction = new lambda.Function(this, 'RespondToNewPasswordChallengeFunction', {
            runtime: lambda.Runtime.NODEJS_20_X,
            handler: 'index.respondToNewPasswordChallenge',
            code: lambda.Code.fromAsset(path.join(__dirname, '../../dist')),
            environment: {
                USER_POOL_ID: userPool.userPoolId,
                USER_POOL_CLIENT_ID: userPoolClient.userPoolClientId,
                NODE_ENV: 'production',
                SESSION_TABLE: sessionsTable.tableName,
                CSRF_SECRET: csrfSecretValue
            }
        });

        // Create a function for getCurrentSession
        const getCurrentSessionFunction = new lambda.Function(this, 'GetCurrentSessionFunction', {
            runtime: lambda.Runtime.NODEJS_20_X,
            handler: 'index.getCurrentSession',
            code: lambda.Code.fromAsset(path.join(__dirname, '../../dist')),
            environment: {
                USER_POOL_ID: userPool.userPoolId,
                USER_POOL_CLIENT_ID: userPoolClient.userPoolClientId,
                NODE_ENV: 'production',
                SESSION_TABLE: sessionsTable.tableName,
                CSRF_SECRET: csrfSecretValue
            }
        });

        // New security-enhanced authentication functions
        const requestChallengeFunction = new lambda.Function(this, 'RequestChallengeFunction', {
            runtime: lambda.Runtime.NODEJS_20_X,
            handler: 'index.requestChallenge',
            code: lambda.Code.fromAsset(path.join(__dirname, '../../dist')),
            environment: {
                USER_POOL_ID: userPool.userPoolId,
                USER_POOL_CLIENT_ID: userPoolClient.userPoolClientId,
                CHALLENGE_TABLE: challengesTable.tableName,
                CSRF_SECRET: csrfSecretValue,
                NODE_ENV: 'production',
                SESSION_TABLE: sessionsTable.tableName
            }
        });

        const loginWithChallengeFunction = new lambda.Function(this, 'LoginWithChallengeFunction', {
            runtime: lambda.Runtime.NODEJS_20_X,
            handler: 'index.loginWithChallenge',
            code: lambda.Code.fromAsset(path.join(__dirname, '../../dist')),
            environment: {
                USER_POOL_ID: userPool.userPoolId,
                USER_POOL_CLIENT_ID: userPoolClient.userPoolClientId,
                CHALLENGE_TABLE: challengesTable.tableName,
                CSRF_SECRET: csrfSecretValue,
                NODE_ENV: 'production',
                SESSION_TABLE: sessionsTable.tableName
            }
        });

        const logoutFunction = new lambda.Function(this, 'LogoutFunction', {
            runtime: lambda.Runtime.NODEJS_20_X,
            handler: 'index.logout',
            code: lambda.Code.fromAsset(path.join(__dirname, '../../dist')),
            environment: {
                USER_POOL_ID: userPool.userPoolId,
                USER_POOL_CLIENT_ID: userPoolClient.userPoolClientId,
                CSRF_SECRET: csrfSecretValue,
                NODE_ENV: 'production',
                SESSION_TABLE: sessionsTable.tableName
            }
        });

        const forgotPasswordFunction = new lambda.Function(this, 'ForgotPasswordFunction', {
            runtime: lambda.Runtime.NODEJS_20_X,
            handler: 'index.forgotPassword',
            code: lambda.Code.fromAsset(path.join(__dirname, '../../dist')),
            environment: {
                USER_POOL_ID: userPool.userPoolId,
                USER_POOL_CLIENT_ID: userPoolClient.userPoolClientId,
                CSRF_SECRET: csrfSecretValue,
                NODE_ENV: 'production',
                SESSION_TABLE: sessionsTable.tableName
            }
        });

        const confirmForgotPasswordFunction = new lambda.Function(this, 'ConfirmForgotPasswordFunction', {
            runtime: lambda.Runtime.NODEJS_20_X,
            handler: 'index.confirmForgotPassword',
            code: lambda.Code.fromAsset(path.join(__dirname, '../../dist')),
            environment: {
                USER_POOL_ID: userPool.userPoolId,
                USER_POOL_CLIENT_ID: userPoolClient.userPoolClientId,
                CSRF_SECRET: csrfSecretValue,
                NODE_ENV: 'production',
                SESSION_TABLE: sessionsTable.tableName
            }
        });

        // Lambda functions
        const getAllPlacesFunction = new lambda.Function(this, 'GetAllPlacesFunction', {
            runtime: lambda.Runtime.NODEJS_20_X,
            handler: 'index.getAllPlaces',
            code: lambda.Code.fromAsset(path.join(__dirname, '../../dist')),
            environment: {
                PLACES_TABLE: placesTable.tableName,
                NODE_ENV: 'production'
            }
        });

        const getPlacesNearbyFunction = new lambda.Function(this, 'GetPlacesNearbyFunction', {
            runtime: lambda.Runtime.NODEJS_20_X,
            handler: 'index.getPlacesNearby',
            code: lambda.Code.fromAsset(path.join(__dirname, '../../dist')),
            environment: {
                PLACES_TABLE: placesTable.tableName,
                NODE_ENV: 'production'
            }
        });

        const getPlaceFunction = new lambda.Function(this, 'GetPlaceFunction', {
            runtime: lambda.Runtime.NODEJS_20_X,
            handler: 'index.getPlace',
            code: lambda.Code.fromAsset(path.join(__dirname, '../../dist')),
            environment: {
                PLACES_TABLE: placesTable.tableName,
                NODE_ENV: 'production'
            }
        });

        const createPlaceFunction = new lambda.Function(this, 'CreatePlaceFunction', {
            runtime: lambda.Runtime.NODEJS_20_X,
            handler: 'index.createPlace',
            code: lambda.Code.fromAsset(path.join(__dirname, '../../dist')),
            environment: {
                PLACES_TABLE: placesTable.tableName,
                NODE_ENV: 'production'
            }
        });

        const updatePlaceFunction = new lambda.Function(this, 'UpdatePlaceFunction', {
            runtime: lambda.Runtime.NODEJS_20_X,
            handler: 'index.updatePlace',
            code: lambda.Code.fromAsset(path.join(__dirname, '../../dist')),
            environment: {
                PLACES_TABLE: placesTable.tableName,
                NODE_ENV: 'production'
            }
        });

        const deletePlaceFunction = new lambda.Function(this, 'DeletePlaceFunction', {
            runtime: lambda.Runtime.NODEJS_20_X,
            handler: 'index.deletePlace',
            code: lambda.Code.fromAsset(path.join(__dirname, '../../dist')),
            environment: {
                PLACES_TABLE: placesTable.tableName,
                NODE_ENV: 'production'
            }
        });

        // lambda functions for user management
        const getUserFunction = new lambda.Function(this, 'GetUserFunction', {
            runtime: lambda.Runtime.NODEJS_20_X,
            handler: 'index.getUser',
            code: lambda.Code.fromAsset(path.join(__dirname, '../../dist')),
            environment: {
                USER_POOL_ID: userPool.userPoolId,
                USER_POOL_CLIENT_ID: userPoolClient.userPoolClientId,
                NODE_ENV: 'production'
            }
        })

        const updateUserFunction = new lambda.Function(this, 'UpdateUserFunction', {
            runtime: lambda.Runtime.NODEJS_20_X,
            handler: 'index.updateUser',
            code: lambda.Code.fromAsset(path.join(__dirname, '../../dist')),
            environment: {
                USER_POOL_ID: userPool.userPoolId,
                USER_POOL_CLIENT_ID: userPoolClient.userPoolClientId,
                NODE_ENV: 'production'
            }
        })

        const setAdminStatusFunction = new lambda.Function(this, 'SetAdminStatusFunction', {
            runtime: lambda.Runtime.NODEJS_20_X,
            handler: 'index.setAdminStatus',
            code: lambda.Code.fromAsset(path.join(__dirname, '../../dist')),
            environment: {
                USER_POOL_ID: userPool.userPoolId,
                USER_POOL_CLIENT_ID: userPoolClient.userPoolClientId,
                NODE_ENV: 'production'
            }
        })

        const validateAdminFunction = new lambda.Function(this, 'ValidateAdminFunction', {
            runtime: lambda.Runtime.NODEJS_20_X,
            handler: 'index.validateAdmin',
            code: lambda.Code.fromAsset(path.join(__dirname, '../../dist')),
            environment: {
                USER_POOL_ID: userPool.userPoolId,
                USER_POOL_CLIENT_ID: userPoolClient.userPoolClientId,
                NODE_ENV: 'production'
            }
        })

        // Add session extension endpoint
        const extendSessionFunction = new lambda.Function(this, 'ExtendSessionFunction', {
            runtime: lambda.Runtime.NODEJS_20_X,
            handler: 'index.extendSession',
            code: lambda.Code.fromAsset(path.join(__dirname, '../../dist')),
            environment: {
                USER_POOL_ID: userPool.userPoolId,
                USER_POOL_CLIENT_ID: userPoolClient.userPoolClientId,
                SESSION_TABLE: sessionsTable.tableName,
                CSRF_SECRET: csrfSecretValue,
                NODE_ENV: 'production'
            }
        });

        // grant permissions
        placesTable.grantReadData(getAllPlacesFunction);
        placesTable.grantReadData(getPlacesNearbyFunction);
        placesTable.grantReadData(getPlaceFunction);
        placesTable.grantReadWriteData(updatePlaceFunction);
        placesTable.grantReadWriteData(deletePlaceFunction);
        placesTable.grantWriteData(createPlaceFunction);

        // For the getCurrentSessionFunction
        userPool.grant(getCurrentSessionFunction, 'cognito-idp:AdminGetUser');
        userPool.grant(getCurrentSessionFunction, 'cognito-idp:ListUsers');

        // You also need to add it to any other functions that use getUserByIdOrUsername
        userPool.grant(getUserFunction, 'cognito-idp:AdminGetUser');
        // Authentication permissions
        userPool.grant(loginFunction, 'cognito-idp:AdminInitiateAuth');
        userPool.grant(loginFunction, 'cognito-idp:AdminGetUser');  // Add this for looking up users
        userPool.grant(loginFunction, 'cognito-idp:ListUsers');     // Add this for searching by sub
        
        userPool.grant(registerFunction, 'cognito-idp:SignUp');
        
        userPool.grant(confirmRegistrationFunction, 'cognito-idp:ConfirmSignUp');
        
        userPool.grant(respondToNewPasswordChallengeFunction, 'cognito-idp:RespondToAuthChallenge');
        userPool.grant(respondToNewPasswordChallengeFunction, 'cognito-idp:AdminGetUser');  // Add this for looking up users
        userPool.grant(respondToNewPasswordChallengeFunction, 'cognito-idp:ListUsers');     // Add this for searching by sub

        userPool.grant(forgotPasswordFunction, 'cognito-idp:ForgotPassword');
        userPool.grant(confirmForgotPasswordFunction, 'cognito-idp:ConfirmForgotPassword');

        // Authentication permissions
        userPool.grant(loginFunction, 'cognito-idp:AdminInitiateAuth');
        userPool.grant(loginFunction, 'cognito-idp:AdminGetUser');  // Add this for looking up users
        userPool.grant(loginFunction, 'cognito-idp:ListUsers');     // Add this for searching by sub
        
        userPool.grant(registerFunction, 'cognito-idp:SignUp');
        
        userPool.grant(confirmRegistrationFunction, 'cognito-idp:ConfirmSignUp');
        
        userPool.grant(respondToNewPasswordChallengeFunction, 'cognito-idp:RespondToAuthChallenge');
        userPool.grant(respondToNewPasswordChallengeFunction, 'cognito-idp:AdminGetUser');  // Add this for looking up users
        userPool.grant(respondToNewPasswordChallengeFunction, 'cognito-idp:ListUsers');     // Add this for searching by sub

        // Permissions for new authentication functions
        challengesTable.grantWriteData(requestChallengeFunction);
        challengesTable.grantReadWriteData(loginWithChallengeFunction);

        userPool.grant(requestChallengeFunction, 'cognito-idp:AdminGetUser');
        userPool.grant(requestChallengeFunction, 'cognito-idp:ListUsers');
        userPool.grant(requestChallengeFunction, 'cognito-idp:AdminUpdateUserAttributes'); // Add this permission to allow storing salt

        

        // Grant permissions for sessions table
        sessionsTable.grantReadWriteData(loginFunction);
        sessionsTable.grantReadWriteData(respondToNewPasswordChallengeFunction);
        sessionsTable.grantReadWriteData(loginWithChallengeFunction);
        sessionsTable.grantReadWriteData(logoutFunction);
        sessionsTable.grantReadData(getCurrentSessionFunction);
        
        // Grant Secrets Manager permissions to all Lambda functions that need the CSRF_SECRET
        const secretsConsumerFunctions = [
            loginFunction, registerFunction, confirmRegistrationFunction,
            respondToNewPasswordChallengeFunction, getCurrentSessionFunction,
            requestChallengeFunction, loginWithChallengeFunction, logoutFunction,
            extendSessionFunction, forgotPasswordFunction, confirmForgotPasswordFunction
        ];
        
        // Grant permission to read the secret to all functions that need it
        for (const func of secretsConsumerFunctions) {
            appSecrets.grantRead(func);
        }
        
        // Add other session-related permission grants
        const allFunctions = [
            getAllPlacesFunction, getPlacesNearbyFunction, getPlaceFunction,
            createPlaceFunction, updatePlaceFunction, deletePlaceFunction,
            getUserFunction, updateUserFunction, setAdminStatusFunction, validateAdminFunction
        ];
        
        // Grant read access to all functions so they can validate sessions
        for (const func of allFunctions) {
            sessionsTable.grantReadData(func);
        }

        // API Gateway
        const api = new apigateway.RestApi(this, 'WorkbruApi', {
            restApiName: 'Workbru API', 
            deployOptions: {
                stageName: 'v1',
            },
            defaultCorsPreflightOptions: {
                allowOrigins: [
                    'http://localhost:5173', // React app URL
                    'https://workbru.com' // Production URL
                ],
                allowMethods: apigateway.Cors.ALL_METHODS,
                allowHeaders: [
                    'Content-Type',
                    'Authorization',
                    'X-CSRF-Token',
                    'X-Amz-Date',
                    'X-Api-Key',
                    'X-Amz-Security-Token'
                ],
                allowCredentials: true
            },
        });

        // API resources and methods
        const placesResource = api.root.addResource('places');
        placesResource.addMethod('GET', new apigateway.LambdaIntegration(getAllPlacesFunction));
        placesResource.addMethod('POST', new apigateway.LambdaIntegration(createPlaceFunction), {
            authorizer,
            authorizationType: apigateway.AuthorizationType.COGNITO,
        });
        

        const placeResource = placesResource.addResource('{id}');
        placeResource.addMethod('GET', new apigateway.LambdaIntegration(getPlaceFunction));
        placeResource.addMethod('PUT', new apigateway.LambdaIntegration(updatePlaceFunction), {
            authorizer,
            authorizationType: apigateway.AuthorizationType.COGNITO,
        });
        placeResource.addMethod('DELETE', new apigateway.LambdaIntegration(deletePlaceFunction), {
            authorizer,
            authorizationType: apigateway.AuthorizationType.COGNITO,
        });

        const placesNearbyResource = placesResource.addResource('nearby')
        placesNearbyResource.addMethod('GET', new apigateway.LambdaIntegration(getPlacesNearbyFunction));

        // api endpoints for user management
        const usersResource = api.root.addResource('users');
        const userResource = usersResource.addResource('{userId}');

        userResource.addMethod('GET', new apigateway.LambdaIntegration(getUserFunction), {
            authorizer,
            authorizationType: apigateway.AuthorizationType.COGNITO,
        });

        userResource.addMethod('PUT', new apigateway.LambdaIntegration(updateUserFunction), {
            authorizer,
            authorizationType: apigateway.AuthorizationType.COGNITO,
        });

        const adminResource = usersResource.addResource('admin');
        adminResource.addMethod('PUT', new apigateway.LambdaIntegration(setAdminStatusFunction), {
            authorizer,
            authorizationType: apigateway.AuthorizationType.COGNITO,
        });

        const adminValidateResource = adminResource.addResource('validate');
        adminValidateResource.addMethod('GET', new apigateway.LambdaIntegration(validateAdminFunction), {
            authorizer,
            authorizationType: apigateway.AuthorizationType.COGNITO,
        });

        // Add session endpoint
        const sessionResource = usersResource.addResource('session');
        sessionResource.addMethod('GET', new apigateway.LambdaIntegration(getCurrentSessionFunction), {
            authorizer,
            authorizationType: apigateway.AuthorizationType.COGNITO,
        });
        
        // Grant the extend session function access to the sessions table
        sessionsTable.grantReadWriteData(extendSessionFunction);
        
        // Add the extend session endpoint to the API
        sessionResource.addMethod('PUT', new apigateway.LambdaIntegration(extendSessionFunction), {
            authorizer,
            authorizationType: apigateway.AuthorizationType.COGNITO,
        });

        // Add authentication endpoints
        const authResource = api.root.addResource('auth');
        authResource.addMethod('POST', new apigateway.LambdaIntegration(loginFunction));

        const registerResource = authResource.addResource('register');
        registerResource.addMethod('POST', new apigateway.LambdaIntegration(registerFunction));

        const confirmResource = registerResource.addResource('confirm');
        confirmResource.addMethod('POST', new apigateway.LambdaIntegration(confirmRegistrationFunction));

        const forgotPasswordResource = authResource.addResource('forgot-password');
        forgotPasswordResource.addMethod('POST', new apigateway.LambdaIntegration(forgotPasswordFunction));

        const confirmForgotPasswordResource = forgotPasswordResource.addResource('confirm');
        confirmForgotPasswordResource.addMethod('POST', new apigateway.LambdaIntegration(confirmForgotPasswordFunction));

        const challengeResource = authResource.addResource('challenge');
        challengeResource.addMethod('POST', new apigateway.LambdaIntegration(respondToNewPasswordChallengeFunction));

        const requestChallengeResource = challengeResource.addResource('request');
        requestChallengeResource.addMethod('POST', new apigateway.LambdaIntegration(requestChallengeFunction));

        const loginWithChallengeResource = challengeResource.addResource('login');
        loginWithChallengeResource.addMethod('POST', new apigateway.LambdaIntegration(loginWithChallengeFunction));

        const logoutResource = authResource.addResource('logout');
        logoutResource.addMethod('POST', new apigateway.LambdaIntegration(logoutFunction));

        // outputs
        new cdk.CfnOutput(this, 'ApiEndpoint', {
            value: api.url, 
            description: 'API Gateway endpoint URL',
        });

        new cdk.CfnOutput(this, 'PlacesTableName', {
            value: placesTable.tableName,
            description: 'DynamoDB table for places',
        });

        new cdk.CfnOutput(this, 'AssetsBucketName', {
            value: assetsBucket.bucketName,
            description: 'S3 bucket for assets',
        });

        new cdk.CfnOutput(this, 'UserPoolId', {
            value: userPool.userPoolId,
            description: 'Cognito User Pool ID',
        });

        new cdk.CfnOutput(this, 'UserpoolClientId', {
            value: userPoolClient.userPoolClientId,
            description: 'Cognito User Pool Client ID',
        });
        
        new cdk.CfnOutput(this, 'SessionsTableName', {
            value: sessionsTable.tableName,
            description: 'DynamoDB table for sessions',
        });

    }
}