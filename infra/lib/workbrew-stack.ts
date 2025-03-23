import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as iam from 'aws-cdk-lib/aws-iam';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as path from 'path';

export class WorkbrewStack extends cdk.Stack {
    constructor(scope: Construct, id: string, props?: cdk.StackProps) {
        super(scope, id, props);

        // DynamoDB table for places
        const placesTable = new dynamodb.Table(this, 'PlacesTable', {
            partitionKey: { name: 'id', type: dynamodb.AttributeType.STRING},
            billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
            removalPolicy: cdk.RemovalPolicy.RETAIN,
        });

        // Create a GSI for location-based queries
        placesTable.addGlobalSecondaryIndex({
            indexName: 'geohash-index',
            partitionKey: { name: 'geohash', type: dynamodb.AttributeType.STRING },
            projectionType: dynamodb.ProjectionType.ALL,
        });

        // S3 bucket for photos and other assets
        const assetsBucket = new s3.Bucket(this, 'WorkbrewAssets', {
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

        // Lambda functions
        const getAllPlacesFunction = new NodejsFunction(this, 'GetAllPlacesFunction', {
            runtime: lambda.Runtime.NODEJS_20_X,
            handler: 'getAllPlaces',
            entry: path.join(__dirname, '../../src/handlers/places.ts'),
            environment: {
                PLACES_TABLE: placesTable.tableName,
            },
        });

        const getPlaceFunction = new NodejsFunction(this, 'GetPlaceFunction', {
            runtime: lambda.Runtime.NODEJS_20_X,
            handler: 'getPlace',
            entry: path.join(__dirname, '../../src/handlers/places.ts'),
            environment: {
                PLACES_TABLE: placesTable.tableName,
            },
        });

        const createPlaceFunction = new NodejsFunction(this, 'CreatePlaceFunction', {
            runtime: lambda.Runtime.NODEJS_20_X,
            handler: 'createPlace',
            entry: path.join(__dirname, '../../src/handlers/places.ts'),
            environment: {
                PLACES_TABLE: placesTable.tableName,
            },
        });

        // grant permissions
        placesTable.grantReadData(getAllPlacesFunction);
        placesTable.grantReadData(getPlaceFunction);
        placesTable.grantWriteData(createPlaceFunction);

        // API Gateway
        const api = new apigateway.RestApi(this, 'WorkbrewApi', {
            restApiName: 'Workbrew API', 
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
        placesResource.addMethod('POST', new apigateway.LambdaIntegration(createPlaceFunction));

        const placeResource = placesResource.addResource('{id}');
        placeResource.addMethod('GET', new apigateway.LambdaIntegration(getPlaceFunction));

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

    }
}