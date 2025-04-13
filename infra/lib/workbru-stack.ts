import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as cognito from 'aws-cdk-lib/aws-cognito'; 
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
        const userPool = new cognito.UserPool(this, 'WorkbruUserPool', {
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
                isAdmin: new cognito.StringAttribute({ mutable: true}), // custom attr for admin
            },
            passwordPolicy: {
                minLength: 8,
                requireLowercase: true,
                requireUppercase: true,
                requireDigits: true,
                requireSymbols: false,
            },
            accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
            removalPolicy: cdk.RemovalPolicy.RETAIN,
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
                NODE_ENV: 'production'
            }
        });

        const registerFunction = new lambda.Function(this, 'RegisterFunction', {
            runtime: lambda.Runtime.NODEJS_20_X,
            handler: 'index.register',
            code: lambda.Code.fromAsset(path.join(__dirname, '../../dist')),
            environment: {
                USER_POOL_ID: userPool.userPoolId,
                USER_POOL_CLIENT_ID: userPoolClient.userPoolClientId,
                NODE_ENV: 'production'
            }
        });

        const confirmRegistrationFunction = new lambda.Function(this, 'ConfirmRegistrationFunction', {
            runtime: lambda.Runtime.NODEJS_20_X,
            handler: 'index.confirmRegistration',
            code: lambda.Code.fromAsset(path.join(__dirname, '../../dist')),
            environment: {
                USER_POOL_ID: userPool.userPoolId,
                USER_POOL_CLIENT_ID: userPoolClient.userPoolClientId,
                NODE_ENV: 'production'
            }
        });

        const respondToNewPasswordChallengeFunction = new lambda.Function(this, 'RespondToNewPasswordChallengeFunction', {
            runtime: lambda.Runtime.NODEJS_20_X,
            handler: 'index.respondToNewPasswordChallenge',
            code: lambda.Code.fromAsset(path.join(__dirname, '../../dist')),
            environment: {
                USER_POOL_ID: userPool.userPoolId,
                USER_POOL_CLIENT_ID: userPoolClient.userPoolClientId,
                NODE_ENV: 'production'
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

        // Create a function for getCurrentSession
        const getCurrentSessionFunction = new lambda.Function(this, 'GetCurrentSessionFunction', {
            runtime: lambda.Runtime.NODEJS_20_X,
            handler: 'index.getCurrentSession',
            code: lambda.Code.fromAsset(path.join(__dirname, '../../dist')),
            environment: {
                USER_POOL_ID: userPool.userPoolId,
                USER_POOL_CLIENT_ID: userPoolClient.userPoolClientId,
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
        userPool.grant(getUserFunction, 'cognito-idp:ListUsers');

        userPool.grant(updateUserFunction, 'cognito-idp:AdminGetUser'); 
        userPool.grant(updateUserFunction, 'cognito-idp:AdminUpdateUserAttributes');
        userPool.grant(updateUserFunction, 'cognito-idp:ListUsers');

        userPool.grant(setAdminStatusFunction, 'cognito-idp:AdminGetUser');
        userPool.grant(setAdminStatusFunction, 'cognito-idp:AdminUpdateUserAttributes');
        userPool.grant(setAdminStatusFunction, 'cognito-idp:ListUsers');

        userPool.grant(validateAdminFunction, 'cognito-idp:AdminGetUser');
        userPool.grant(validateAdminFunction, 'cognito-idp:ListUsers');

        userPool.grant(loginFunction, 'cognito-idp:AdminInitiateAuth');
        userPool.grant(registerFunction, 'cognito-idp:SignUp');
        userPool.grant(confirmRegistrationFunction, 'cognito-idp:ConfirmSignUp');
        userPool.grant(respondToNewPasswordChallengeFunction, 'cognito-idp:RespondToAuthChallenge');

        // API Gateway
        const api = new apigateway.RestApi(this, 'WorkbruApi', {
            restApiName: 'Workbru API', 
            deployOptions: {
                stageName: 'v1',
            },
            defaultCorsPreflightOptions: {
                allowOrigins: apigateway.Cors.ALL_ORIGINS,
                allowMethods: apigateway.Cors.ALL_METHODS,
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

        // Add authentication endpoints
        const authResource = api.root.addResource('auth');
        authResource.addMethod('POST', new apigateway.LambdaIntegration(loginFunction));

        const registerResource = authResource.addResource('register');
        registerResource.addMethod('POST', new apigateway.LambdaIntegration(registerFunction));

        const confirmResource = registerResource.addResource('confirm');
        confirmResource.addMethod('POST', new apigateway.LambdaIntegration(confirmRegistrationFunction));

        const challengeResource = authResource.addResource('challenge');
        challengeResource.addMethod('POST', new apigateway.LambdaIntegration(respondToNewPasswordChallengeFunction));

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

    }
}