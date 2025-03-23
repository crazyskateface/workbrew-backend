import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import * as placeService from '../services/placeService.js';
import { PlaceSchema } from '../models/place.js';
import { z } from 'zod';

export async function getAllPlaces(): Promise<APIGatewayProxyResult> {
    try {
        const places = await placeService.getAllPlaces();

        return buildRes(200, places);
    } catch (error) {
        console.error('Error fetching places: ', error);

        return buildRes(500, 'Error fetching places', error);
    }
}

export async function getPlace(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    try {
        const id = event.pathParameters?.id;

        if (!id) {
            return buildRes(400, 'Missing place ID');
        }

        const place = await placeService.getPlaceById(id);

        if (!place) {
            return buildRes(404, 'Place not found');
        }

        return buildRes(200, place);
    } catch (error) {
        console.error('Error fetching place:', error);
        return buildRes(500, 'Error fetching place', error);
    }
}

export async function createPlace(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    try {
        if (!event.body) {
            return buildRes(400, 'Missing request body');
        }

        const placeData = JSON.parse(event.body);

        try {
            // validate input data (without id, createdAt, updatedAt)
            const { id, createdAt, updatedAt, ...inputData } = PlaceSchema.parse(placeData);

            const newPlace = await placeService.createPlace(inputData);
            return buildRes(201, newPlace);
        
        } catch (validationError) {
            if (validationError instanceof z.ZodError) {
                return buildRes(400, 'Invalid place data', validationError);
            }
            throw validationError;
        }
    } catch (error) {
        console.error('Error creating place: ' , error);
        return buildRes(500, 'Error creating place', error);
    }
}

function buildRes(statusCode: number, message: any, error?: any) {
    
    var body: {message: string, error?: string} = {message: ""}
    if (typeof message === 'string') {
        body.message = message
    } else {
        body.message = JSON.stringify(message);
    }
    if (error) {
        body.error = error.errors
    } else {
        // remove the error key if there is no error
        delete body.error
    }
    
    return {
        statusCode: statusCode,
        headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
        },
        
        body: JSON.stringify(body)
    }
}