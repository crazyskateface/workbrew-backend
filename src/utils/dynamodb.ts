import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import {
    DynamoDBDocumentClient,
    PutCommand,
    GetCommand,
    QueryCommand,
    ScanCommand,
    DeleteCommand,
    UpdateCommand
} from '@aws-sdk/lib-dynamodb';
import { localDb } from './localdb.js';
import { ReturnValue } from '@aws-sdk/client-dynamodb';

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



export async function updateItem(
    tableName: string, 
    key: Record<string, any>, 
    updateExpression: string, 
    expressionAttributeNames:Record<string, any>, 
    expressionAttributeValues: Record<string, any>,
    returnValues: ReturnValue = 'ALL_NEW'
): Promise<Record<string, any> | null> {
    if (useLocalDb) {
        // return localDb.updateItem(tableName, key, updateExpression, expressionAttributeNames, expressionAttributeValues);
        console.warn('Local DB updateItem is not fully implemented - using putItem instead');
        return null;
    }
    try {
        const response = await docClientInstance!.send(
            new UpdateCommand({
                TableName: tableName,
                Key: key,
                UpdateExpression: updateExpression,
                ExpressionAttributeNames: expressionAttributeNames,
                ExpressionAttributeValues: expressionAttributeValues,
                ReturnValues: returnValues,
            })
        );

        return response.Attributes || null;
    } catch (error) {
        console.error(`Error updating item in ${tableName}:`, error); 
        throw new Error(`DynamoDB update failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
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

/**
 * Helper function to update an item with a set of fields
 */
export async function updateFields(
    tableName: string,
    key: Record<string, any>,
    fields: Record<string, any>
): Promise<Record<string, any> | null> {
    // For the local DB case, it's simpler to just get the item, update it, and put it back
    if (useLocalDb) {
        return localDb.updateItem(tableName, key, fields);
    }
    
    // Build the update expression dynamically based on the fields object
    const updateExpressions: string[] = [];
    const expressionAttributeNames: Record<string, string> = {};
    const expressionAttributeValues: Record<string, any> = {};

    // get a list of key attribute names to exclude them from the update
    const keyAttributeNames = Object.keys(key);
    
    Object.entries(fields).forEach(([key, value]) => {
        if (value !== undefined && !keyAttributeNames.includes(key)) {
            updateExpressions.push(`#${key} = :${key}`);
            expressionAttributeNames[`#${key}`] = key;
            expressionAttributeValues[`:${key}`] = value;
        }
    });
    
    // If no fields to update, return null
    if (updateExpressions.length === 0) {
        return null;
    }
    
    return updateItem(
        tableName,
        key,
        `SET ${updateExpressions.join(', ')}`,
        expressionAttributeNames,
        expressionAttributeValues
    );
}

// for backward compatibility with existing imports 
export { docClientInstance };