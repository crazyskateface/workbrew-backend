import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
    DynamoDBDocumentClient,
    PutCommand,
    GetCommand,
    QueryCommand,
    ScanCommand,
    DeleteCommand
} from '@aws-sdk/lib-dynamodb';
import { localDb } from './localdb.js';

export const PLACES_TABLE = process.env.PLACES_TABLE || 'workbru-places';

// Environmet detection
const isLocalDev = process.env.NODE_ENV !== 'production';
let useLocalDb = isLocalDev;

console.log(`[DB] Running in ${process.env.NODE_ENV || 'unknown'} environment`);

// try to initialize the dynamodb client, but fall back to local if it fails
let dynamoDbInstance: DynamoDBClient | null = null;
let docClientInstance: DynamoDBDocumentClient | null = null;

if (!isLocalDev) {
    try {   
        // In production, credentials should come from:
        // 1. For Lambda: IAM roles
        // 2. For EC2: Instance profiles
        // 3. For local dev against real AWS: AWS credentials file or env vars
        dynamoDbInstance = getDynamoDbClient();

        // Add custom marshalling options for better data conversion
        docClientInstance = getDocClient();

        // test the connection by making a simple call in a real app consider a better approach
        console.log('Using AWS DynamoDB in production');

        // if we get here, we'll use the real dyanmo
        // useLocalDb = false;
        // console.log('Using AWS DynamoDB');
    } catch (err) {
        console.log('AWS DynamoDB connection faled, using local db instead');
        // console.log(err);
        throw new Error('Failed to initialize DynamoDB client in production');
    }
} else {
    console.log('Development mode: using local in-memory db');
    useLocalDb = true;
}

// dynamodb connection pooling
export function getDynamoDbClient(): DynamoDBClient {
    if (!dynamoDbInstance) {
        dynamoDbInstance = new DynamoDBClient({
            region: process.env.AWS_REGION || 'us-east-1',
            maxAttempts: 3
        });
    }
    return dynamoDbInstance;
}

export function getDocClient(): DynamoDBDocumentClient {
    if(!docClientInstance) {
        docClientInstance = DynamoDBDocumentClient.from(getDynamoDbClient(), {
            marshallOptions: {
                removeUndefinedValues: true,
                convertEmptyValues: true
            }
        });
    }
    return docClientInstance;
}


export async function putItem(tablename: string, item: Record<string, any>): Promise<void> {
    if (useLocalDb) {
        await localDb.putItem(tablename, item);
        return;
    }
    await docClientInstance!.send(
        new PutCommand({
            TableName: tablename,
            Item: item,
        })
    );
}

export async function getItem(tableName: string, key: Record<string, any>): Promise<Record<string, any> | null> {
    if (useLocalDb) {
        return localDb.getItem(tableName, key);
    }

    try {
        const response = await docClientInstance!.send(
            new GetCommand({
                TableName: tableName,
                Key: key,
            })
        );
        return response.Item || null;
    } catch (error) {
        console.error(`Error getting item from ${tableName}:`, error);
        throw new Error(`DynamoDB get failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}

export async function queryItems(
    tablename: string,
    keyConditionExpression: string,
    expressionAttributeValues: Record<string, any>,
    indexName?: string
): Promise<Record<string, any>[]> {
    if (useLocalDb) {
        return localDb.queryItems(tablename, keyConditionExpression, expressionAttributeValues);
    }
    try {
        const response = await docClientInstance!.send(
            new QueryCommand({
                TableName: tablename,
                KeyConditionExpression: keyConditionExpression,
                ExpressionAttributeValues: expressionAttributeValues,
                IndexName: indexName,
            })
        );
        return response.Items || [];
    } catch (error) {
        console.error(`Error querying items from ${tablename}:`, error);
        throw new Error(`DynamoDB query failed: ${error instanceof Error ? error.message: 'Unknown error'}`)
    }
}

export async function scanItems(tableName: string): Promise<Record<string, any>[]> {
    if (useLocalDb) {
        return localDb.scanItems(tableName)
    }
    try {
        const response = await docClientInstance!.send(
            new ScanCommand({
                TableName: tableName,
            })
        );

        return response.Items || [];
    } catch (error) {
        console.error(`Error scanning items from ${tableName}:`, error);
        throw new Error(`DynamoDB scan failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }

}

export async function deleteItem(tableName: string, key: Record<string, any>): Promise<void> {
    if (useLocalDb) {
        return localDb.deleteItem(tableName, key);
    }

    try {
        await docClientInstance!.send(
            new DeleteCommand({
                TableName: tableName,
                Key: key,
            })
        );
    } catch (error) {
        console.error(`Error deleting item from ${tableName}:`, error);
        throw new Error(`DynamoDB delete failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
}

// for backward compatibility with existing imports 
export { docClientInstance };