import { serve } from "bun";
import * as placeService from './services/placeService.js';
import { Place, PlaceSchema } from './models/place.js';
import { z } from 'zod';

const PORT = process.env.PORT || 3000;

const server = serve({
    port: PORT,
    async fetch(req) {
        const url = new URL(req.url);
        const path = url.pathname;
        const method = req.method;

        const headers = new Headers({
            "Access-Control-Allow-Origin": "*",
            "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
            "Access-Control-Allow-Headers": "Content-Type",
            "Content-Type": "application/json",
        });

        // Handle OPTIONS preflight request
        if (method === "OPTIONS") {
            return new Response(null, { headers } );
        }

        try {
            // places collection endpoints
            if (path === '/places') {
                // get all places
                if (method === 'GET') {
                    const places = await placeService.getAllPlaces();
                    return new Response(JSON.stringify(places), { headers });
                }

                // create a new place
                if (method === 'POST') {
                    try {
                        const placeData = await req.json();
                        //validate input data (without id, createdAt, updatedAt)
                        const { id, createdAt, updatedAt, ...inputData } = PlaceSchema.parse(placeData);
                        const newPlace = await placeService.createPlace(inputData);
                        return new Response(JSON.stringify(newPlace), {
                            status: 201,
                            headers
                        });

                    } catch (validationError) {
                        if (validationError instanceof z.ZodError) {
                            return new Response(JSON.stringify({
                                message: 'Validation error',
                                errors: validationError.errors
                            }), { status: 400, headers})
                        }
                        throw validationError;
                    }
                }
            }

            // nearby places endpoint
            if (path === '/places/nearby') {
                if (method === 'GET') {
                    // get query params
                    const lat = parseFloat(url.searchParams.get('lat') || '');
                    const lng = parseFloat(url.searchParams.get('lng') || '');
                    const radiusKm = parseFloat(url.searchParams.get('radius') || '5'); // default 5km

                    // validate params
                    if (isNaN(lat) || isNaN(lng)) {
                        return new Response(JSON.stringify({
                            message: 'Invalid parameters. Please provide valid lat and lng values.'
                        }), {
                            status: 400,
                            headers
                        });
                    }

                    // get nearby places
                    const places = await placeService.getPlacesNearby(lat, lng, radiusKm);

                    // Add distance to each place
                    const placesWithDistance = places.map(place => ({
                        ...place,
                        distanceKm: calculateDistance(
                            lat,
                            lng,
                            place.location.latitude,
                            place.location.longitude
                        )
                    }));

                    // sort by distance
                    placesWithDistance.sort((a, b) => a.distanceKm - b.distanceKm);

                    return new Response(JSON.stringify(placesWithDistance), { headers });
                }
            }

            // single place endpoints - match /places/{id} pattern
            const placeMatch = path.match(/^\/places\/([a-zA-Z0-9-]+)$/);
            if (placeMatch) {
                const id = placeMatch[1];

                // get a specific place
                if (method === 'GET') {
                    const place = await placeService.getPlaceById(id);

                    if (!place) {
                        return new Response(JSON.stringify({ message: "Place not found" }), {
                            status: 404,
                            headers
                        });
                    }

                    return new Response(JSON.stringify(place), { headers } );
                }
            }

            // if no route matches
            return new Response(JSON.stringify({ message: "Not found" }), {
                status: 404,
                headers
            });
        } catch (error) {
            console.error("Server error: ", error);
            return new Response(JSON.stringify({ message: "Internal server error" }), {
                status: 500,
                headers
            });
        }
    }
});

// Helper function to calculate distance between two points
function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
    const R = 6371; // Earth radius in km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = 
        Math.sin(dLat/2) * Math.sin(dLat/2) +
        Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
        Math.sin(dLon/2) * Math.sin(dLon/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return Math.round((R * c) * 100) / 100; // Round to 2 decimal places
}

console.log(`🚀 Local server running at http://localhost:${PORT}`);