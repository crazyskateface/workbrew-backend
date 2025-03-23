import { v4 as uuidv4 } from 'uuid';
import * as dynamodb from '../utils/dynamodb.js';
import { Place, PlaceSchema } from '../models/place.js';

export async function getAllPlaces(): Promise<Place[]> {
    const items = await dynamodb.scanItems(dynamodb.PLACES_TABLE);
    return items as Place[];
}

export async function getPlaceById(id: string): Promise<Place | null> {
    const item = await dynamodb.getItem(dynamodb.PLACES_TABLE, { id });
    return item as Place | null;
}

export async function createPlace(placeData: Omit<Place, 'id' | 'createdAt' | 'updatedAt'>): Promise<Place> {
    const now = new Date().toISOString();

    const newPlace: Place = {
        ...placeData,
        id: uuidv4(),
        createdAt: now,
        updatedAt: now,
    };

    // calculate geohash for the place
    if (newPlace.location) {
        newPlace.geohash = encodeGeohash(newPlace.location.latitude, newPlace.location.longitude);
    }

    //validate the place data
    PlaceSchema.parse(newPlace);

    await dynamodb.putItem(dynamodb.PLACES_TABLE, newPlace);
    return newPlace;
}

export async function updatePlace(id: string, placeData: Partial<Place>): Promise<Place | null> {
    const existingPlace = await getPlaceById(id);

    if (!existingPlace) {
        return null;
    }

    const updatedPlace: Place = {
        ...existingPlace,
        ...placeData,
        updatedAt: new Date().toISOString(),
    };

    // recalc geohash if location updated
    if (placeData.location) {
        updatedPlace.geohash = encodeGeohash(
            updatedPlace.location.latitude,
            updatedPlace.location.longitude
        );
    }

    // Merge updated attributes and amenities
    updatedPlace.amenities = {
        ...existingPlace.amenities,
        ...placeData.amenities,
    };

    updatedPlace.attributes = {
        ...existingPlace.attributes,
        ...placeData.attributes,
    };

    // Validate the updated place data
    PlaceSchema.parse(updatedPlace);

    await dynamodb.putItem(dynamodb.PLACES_TABLE, updatedPlace);
    return updatedPlace;
}

export async function deletePlace(id: string): Promise<boolean> {
    const existingPlace = await getPlaceById(id);

    if (!existingPlace) {
        return false;
    }

    await dynamodb.deleteItem(dynamodb.PLACES_TABLE, { id });

    return true;
}

export async function getPlacesNearby(lat: number, lng: number, radiusKm: number): Promise<Place[]> {
    // step 1. calculate the geohash for the search point
    const centerGeohash = encodeGeohash(lat, lng);

    // step 2. calculate the bounding box for the search radius
    const boundingBox = calculateBoundingBox(lat, lng, radiusKm);

    // Get relevant geohash prefixes for the area
    // In production, we need to calculate ACTUAL neighboring cells
    const geohashPrefixes = calculateNeighborGeohashes(centerGeohash, 5);

    // use the GSI to query places by geohash prefix
    let results: Place[] = [];

    

    

    // step 4. get neighbor geohashes that could contain points within our radius
    const neighborGeohashes = getNeighborGeohashes(centerGeohash, boundingBox);

    // step 5. First-pass filter - check if place's geohash has a common prefix with relevant geohashes
    // this simulates what a spatial index would do to narrow down candidates
    const candidatePlaces = allPlaces.filter(place => {
        if (!place.location || !place.geohash) {
            // calc geohash for places that dont have it (legacy data)
            place.geohash = encodeGeohash(place.location.latitude, place.location.longitude);
        }

        // check if the place's geohash matches any of our neighbor geohashes with precision 5
        // ( precision 5 is about 4.9km x 4.9km call size)
        const geohashPrefix = place.geohash.substring(0, 5);
        return neighborGeohashes.some(hash => hash.startsWith(geohashPrefix));
    });

    console.log('First-pass filter: ${candidatePlaces.length} of ${allPlaces.length} places are candidates')

    // step 6. Second-pass filter - accurate distance calculation on the candidates
    const nearbyPlaces = candidatePlaces.filter(place => {
        if(!place.location) return false;

        const distance = calculateDistance(
            lat, lng, place.location.latitude, place.location.longitude
        );

        // save the distance for later use
        place.distance = distance;

        return distance <= radiusKm;
    })

    // step 7. Sort by distance
    nearbyPlaces.sort((a, b) => (a.distance || 0) - (b.distance || 0));
    return nearbyPlaces;
    
}

function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number ): number {
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

// calculate a bounding box given a center point and radius 
function calculateBoundingBox(lat: number, lng: number, radiusKm: number) {
    const latKm = 110.574; // km per degree of latitude
    const lngKm = 111.320 * Math.cos(lat * Math.PI / 180); // km per degree of longitude

    const latDelta = radiusKm / latKm;
    const lngDelta = radiusKm / lngKm;

    return {
        minLat: lat - latDelta,
        maxLat: lat + latDelta,
        minLng: lng - lngDelta,
        maxLng: lng + lngDelta
    };
}

// geohash encoding - simplified version
function encodeGeohash(lat: number, lng: number, precision: number = 9): string {
    const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';
    let geohash = '';
    let bits = 0;
    let bitsTotal = 0;
    let hashValue = 0;
    let maxLat = 90;
    let minLat = -90;
    let maxLng = 180;
    let minLng = -180;
    let mid: number;

    while (geohash.length < precision) {
        if (bitsTotal % 2 === 0) {
            // longitude
            mid = (maxLng + minLng) / 2;
            if (lng > mid) {
                hashValue = (hashValue << 1) + 1;
                minLng = mid;
            }else {
                hashValue = (hashValue << 1) + 0;
                minLng = mid;
            }
        } else {
            // latitude
            mid = (maxLat + minLat) /2;
            if (lat > mid) {
                hashValue = (hashValue << 1) + 1;
                minLat = mid;
            } else {
                hashValue = (hashValue << 1) + 0;
                maxLat = mid;
            }
        }

        bits++;
        bitsTotal++;

        if (bits === 5) {
            geohash += BASE32.charAt(hashValue);
            bits = 0;
            hashValue = 0;
        }
    }

    return geohash;
}

// get neighboring peohashes based on a bounding box
function getNeighborGeohashes(centerGeohash: string, boundingBox: any) : string[] {
    // for simplicity we'll use the center geohash and its prefix 
    // in a real implementation we would calculate all neighboring cells 
    /// this simulates what a psatial database would do to find candidate cells 

    // use first 5 characters (precision 5 is about 4.9km x 4.9km)
    const prefix = centerGeohash.substring(0, 5);

    // return the prefix (simulating a spatial search)
    return [prefix];
}

// Production-ready function to calculate