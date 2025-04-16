import { APIGatewayProxyEvent, APIGatewayProxyResult } from 'aws-lambda';
import * as placeService from '../services/placeService.js';
import * as permissionService from '../services/permissionService.js';
import { Permission } from '../services/permissionService.js';
import { PlaceSchema } from '../models/place.js';
import * as headerUtils from '../utils/headers.js';
import { z } from 'zod';
import { v4 as uuidv4 } from 'uuid';

export async function getAllPlaces(): Promise<APIGatewayProxyResult> {
    try {
        const places = await placeService.getAllPlaces();

        return buildRes(200, places);
    } catch (error) {
        console.error('Error fetching places: ', error);

        // Determine if this is a client or server error
        if (error instanceof z.ZodError) {
            return buildRes(400, 'Invalid data format', error);
        }

        // log additonal details in prod
        const errorId = uuidv4(); // generate a unique error ID
        console.error(`Error ID: ${errorId}`, error);

        return buildRes(500, 'Error fetching places', error);
    }
}

export async function getPlacesNearby(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    try {
        const lat = parseFloat(event.queryStringParameters?.lat||"32.7749");
        if (!lat) {
            return buildRes(400, 'Missing latitude');
        }
        const lng = parseFloat(event.queryStringParameters?.lng || "-122.3085");
        if (!lng) {
            return buildRes(400, 'Missing longitude');
        }
        const radius = parseInt(event.queryStringParameters?.radius || "10");
        if (!radius) {
            return buildRes(400, 'Missing Radius(km)');
        }
        console.log(`Searching for places near lat=${lat}, lng=${lng}, radius=${radius}km`);

        const places = await placeService.getPlacesNearby(lat, lng, radius);

        return buildRes(200, places);
    } catch (error) {
        console.error('Error fetching places: ', error);

        // Determine if this is a client or server error
        if (error instanceof z.ZodError) {
            return buildRes(400, 'Invalid data format', error);
        }

        // log additonal details in prod
        const errorId = uuidv4(); // generate a unique error ID
        console.error(`Error ID: ${errorId}`, error);

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

        // Determine if this is a client or server error
        if (error instanceof z.ZodError) {
            return buildRes(400, 'Invalid data format', error);
        }

        // log additonal details in prod
        const errorId = uuidv4(); // generate a unique error ID
        console.error(`Error ID: ${errorId}`, error);

        return buildRes(500, 'Error fetching place', error);
    }
}

export async function createPlace(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    try {
        // Extract the authenticated user's ID
        const userId = event.requestContext.authorizer?.claims?.sub;
        if (!userId) {
            return buildRes(401, 'Authentication required');
        }

        // check if user has permission to create places
        const hasPermission = await permissionService.hasPermission(
            userId,
            Permission.CREATE_PLACE
        )

        if (!hasPermission) {
            return buildRes(403, 'You do not have permission to create a place');
        }

        if (!event.body) {
            return buildRes(400, 'Missing request body');
        }
        const placeData = JSON.parse(event.body);

        try {
            // validate input data (without id, createdAt, updatedAt)
            const { id, createdAt, updatedAt, ...inputData } = PlaceSchema.parse(placeData);

            const newPlace = await placeService.createPlace(inputData, userId);
            return buildRes(201, newPlace);
        
        } catch (validationError) {
            if (validationError instanceof z.ZodError) {
                return buildRes(400, 'Invalid place data', validationError);
            }
            throw validationError;
        }
    } catch (error) {
        console.error('Error creating place: ' , error);

        // Determine if this is a client or server error
        if (error instanceof z.ZodError) {
            return buildRes(400, 'Invalid data format', error);
        }

        // log additonal details in prod
        const errorId = uuidv4(); // generate a unique error ID
        console.error(`Error ID: ${errorId}`, error);
        
        return buildRes(500, 'Error creating place', error);
    }
}

export async function updatePlace(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    try {
        // Extract the authenticated user's ID
        const userId = event.requestContext.authorizer?.claims?.sub;
        if (!userId) {
            return buildRes(401, 'Authentication required');
        }
        
        const id = event.pathParameters?.id;

        if (!id) {
            return buildRes(400, 'Missing place ID');
        }

        // Check if user has permission to update this place
        const hasPermission = await permissionService.hasPermission(
            userId, 
            Permission.UPDATE_PLACE,
            id
        );
        
        if (!hasPermission) {
            return buildRes(403, 'You do not have permission to update this place');
        }

        if (!event.body) {
            return buildRes(400, 'Missing request body');
        }

        // check if placce exists
        const existingPlace = await placeService.getPlaceById(id);
        if (!existingPlace) {
            return buildRes(404, 'Place not found');
        }
        if (existingPlace.createdBy && existingPlace.createdBy !== userId) {
            return buildRes(403, 'You do not have permission to update this place');
        }

        const updateData = JSON.parse(event.body);

        try {
            // remove immutable fields from the validation
            const { id: _, createdAt, updatedAt, ...inputData } = updateData;

            // validate the update data
            PlaceSchema.partial().parse(inputData);

            // update the place
            const updatedPlace = await placeService.updatePlace(id, inputData);
            return buildRes(200, updatedPlace);
        } catch (validationError) {
            if (validationError instanceof z.ZodError) {
                return buildRes(400, 'Invalid place data', validationError);
            }
            throw validationError;
        }
    } catch (error) {
        console.error('Error updating place: ' , error);

        // Determine if this is a client or server error
        if (error instanceof z.ZodError) {
            return buildRes(400, 'Invalid data format', error);
        }

        // log additonal details in prod
        const errorId = uuidv4(); // generate a unique error ID
        console.error(`Error ID: ${errorId}`, error);
        
        return buildRes(500, 'Error updating place', error);
    }
}

export async function deletePlace(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
    try {
        // Extract the authenticated user's ID
        const userId = event.requestContext.authorizer?.claims?.sub;
        if (!userId) {
            return buildRes(401, 'Authentication required');
        }
        
        const id = event.pathParameters?.id;
        if (!id) {
            return buildRes(400, 'Missing place ID');
        }
        
        // Check if user has permission to delete this place
        const hasPermission = await permissionService.hasPermission(
            userId, 
            Permission.DELETE_PLACE,
            id
        );
        
        if (!hasPermission) {
            return buildRes(403, 'You do not have permission to delete this place');
        }

        // check if place exists
        const existingPlace = await placeService.getPlaceById(id);
        if (!existingPlace) {
            return buildRes(404, 'Place not found');
        }

        const success = await placeService.deletePlace(id);

        if (success) {
            return buildRes(200, { message: 'Place deleted successfully'});
        } else {
            return buildRes(500, 'Failed to delete place')
        }
    } catch(error) {
        console.error('Error deleting place: ', error);

        const errorId = uuidv4();
        console.error(`Error ID: ${errorId}`, error);

        return buildRes(500, 'Error deletingpalce', error);
    }
}

function buildRes(statusCode: number, message: any, error?: any) {
    let body: Record<string, any> = {};
    
    if (typeof message === 'string') {
        body.message = message;
    } else if (typeof message === 'object') {
        body = { ...message };
    } else {
        body.message = String(message);
    }
    
    if (error) {
        body.error = error.errors || error.message || String(error);
    }
    
    return headerUtils.createApiResponse(statusCode, body);
}