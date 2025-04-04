import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as apigateway from 'aws-cdk-lib/aws-apigateway';
import * as iam from 'aws-cdk-lib/aws-iam';
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

        console.log(path.join(__dirname, '../../dist'));

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

        // grant permissions
        placesTable.grantReadData(getAllPlacesFunction);
        placesTable.grantReadData(getPlacesNearbyFunction);
        placesTable.grantReadData(getPlaceFunction);
        placesTable.grantWriteData(createPlaceFunction);

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
        placesResource.addMethod('POST', new apigateway.LambdaIntegration(createPlaceFunction));

        const placeResource = placesResource.addResource('{id}');
        placeResource.addMethod('GET', new apigateway.LambdaIntegration(getPlaceFunction));

        const placesNearbyResource = placesResource.addResource('nearby')
        placesNearbyResource.addMethod('GET', new apigateway.LambdaIntegration(getPlacesNearbyFunction));

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