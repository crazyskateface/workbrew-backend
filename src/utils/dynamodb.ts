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

export const PLACES_TABLE = process.env.PLACES_TABLE || 'workbrew-places';

// Environmet detection
const isLocalDev = process.env.NODE_ENV !== 'production';
let useLocalDb = isLocalDev;

console.log(`[DB] Running in ${process.env.NODE_ENV || 'unknown'} environment`);

// try to initialize the dynamodb client, but fall back to local if it fails
let client: DynamoDBClient | null = null;
let docClient: DynamoDBDocumentClient | null = null;

if (!isLocalDev) {
    try {   
        client = new DynamoDBClient({
            region: process.env.AWS_REGION || 'us-east-1',
        });
        docClient = DynamoDBDocumentClient.from(client);

        // test the connection by making a simple call in a real app consider a better approach
        console.log('Attempting to connecto to aws dynamodb...');

        // if we get here, we'll use the real dyanmo
        useLocalDb = false;
        console.log('Using AWS DynamoDB');
    } catch (err) {
        console.log('AWS DynamoDB connection faled, using local db instead');
        console.log(err);
        useLocalDb = true;
    }
} else {
    console.log('Development mode: using local in-memory db');
    useLocalDb = true;
}


export async function putItem(tablename: string, item: Record<string, any>): Promise<void> {
    if (useLocalDb) {
        await localDb.putItem(tablename, item);
        return;
    }
    await docClient!.send(
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

    const response = await docClient!.send(
        new GetCommand({
            TableName: tableName,
            Key: key,
        })
    );

    return response.Item || null;
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
    const response = await docClient!.send(
        new QueryCommand({
            TableName: tablename,
            KeyConditionExpression: keyConditionExpression,
            ExpressionAttributeValues: expressionAttributeValues,
            IndexName: indexName,
        })
    );

    return response.Items || [];
}

export async function scanItems(tableName: string): Promise<Record<string, any>[]> {
    if (useLocalDb) {
        return localDb.scanItems(tableName)
    }
    const response = await docClient!.send(
        new ScanCommand({
            TableName: tableName,
        })
    );

    return response.Items || [];
}

export async function deleteItem(tableName: string, key: Record<string, any>): Promise<void> {
    if (useLocalDb) {
        return localDb.deleteItem(tableName, key);
    }

    await docClient!.send(
        new DeleteCommand({
            TableName: tableName,
            Key: key,
        })
    );
}

// for backward compatibility with existing imports 
export { docClient };