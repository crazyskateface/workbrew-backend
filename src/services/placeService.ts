import { v4 as uuidv4 } from 'uuid';
import * as dynamodb from '../utils/dynamodb.js';
import { Place, PlaceSchema } from '../models/place.js';
import geohash from 'ngeohash';

const cache = new Map<string, {data: any, timestamp: number}>();
const CACHE_TTL = 60 * 1000; // 1 minute

export async function getAllPlaces(): Promise<Place[]> {
    const items = await dynamodb.scanItems(dynamodb.PLACES_TABLE);
    return items as Place[];
}

export async function getPlaceById(id: string): Promise<Place | null> {
    // check cache first
    const cacheKey = `place:${id}`;
    const cachedItem = cache.get(cacheKey);

    if (cachedItem && (Date.now() - cachedItem.timestamp < CACHE_TTL)) {
        return cachedItem.data as Place;
    }


    const item = await dynamodb.getItem(dynamodb.PLACES_TABLE, { id });

    // store in cache
    if (item) {
        cache.set(cacheKey, {
            data: item, 
            timestamp: Date.now()
        });
    }

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
    try {
        // In prod, add timing metrics
        const startTime = Date.now();
        // step 1. calculate the geohash for the search point
        const centerGeohash = encodeGeohash(lat, lng);

        // step 2. calculate the bounding box for the search radius
        const boundingBox = calculateBoundingBox(lat, lng, radiusKm);

        // step 3. Get relevant geohash prefixes for the area
        // In production, we need to calculate ACTUAL neighboring cells
        const geohashPrefixes = calculateNeighborGeohashes(centerGeohash, boundingBox);

        // step 4. use the GSI to query places by geohash prefix
        

        // step 5. In production, we'd use a batch of Promise.all queries for each relevant prefix
        const prefixQueries = geohashPrefixes.map(prefix => 
            dynamodb.queryItems(
                dynamodb.PLACES_TABLE,
                'begins_with(geohash, :prefix)',
                {':prefix': prefix},
                'geohash-index'
            )
        );

        const queryResults = await Promise.all(prefixQueries);
        const results = queryResults.flat() as Place[];

        // // step 6. Second-pass filter - accurate distance calculation on the candidates
        const nearbyPlaces = results.filter(place => {
            if(!place.location) return false;

            const distance = calculateDistance(
                lat, lng, place.location.latitude, place.location.longitude
            );

            // save the distance for later use
            place.distance = distance;

            return distance <= radiusKm;
        })

        // // step 7. Sort by distance
        nearbyPlaces.sort((a, b) => (a.distance || 0) - (b.distance || 0));

        // Record performance metrics 
        const endTime = Date.now();
        const duration = endTime - startTime;
        console.log(`Found ${nearbyPlaces.length} places in ${duration}ms`);

        return nearbyPlaces;
    } catch (err) {
        console.error('Error fetching nearby places: ', err);
        throw new Error(`Failed to fetch nearby places: ${err instanceof Error? err.message: 'Unknown error'}`);
    }
    
}

export function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number ): number {
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
export function calculateBoundingBox(lat: number, lng: number, radiusKm: number) {
    const latKm = 110.574; // km per degree of latitude
    const lngKm = 111.320 * Math.cos(lat * Math.PI / 180); // km per degree of longitude

    const latDelta = radiusKm / latKm;
    const lngDelta = radiusKm / lngKm;

    return {
        minLat: lat - latDelta,
        maxLat: lat + latDelta,
        minLng: lng - lngDelta,
        maxLng: lng + lngDelta,
    };
    // return geohash.bboxes(lat - latDelta,
    //     lat + latDelta,
    //     lng - lngDelta,
    //     lng + lngDelta, 9)
    
}

// geohash encoding - simplified version
export function encodeGeohash(lat: number, lng: number, precision: number = 9): string {
    const hash = geohash.encode(lat, lng, precision);
//     const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';
//     let geohash = '';
//     let bits = 0;
//     let bitsTotal = 0;
//     let hashValue = 0;
//     let maxLat = 90;
//     let minLat = -90;
//     let maxLng = 180;
//     let minLng = -180;
//     let mid: number;

//     while (geohash.length < precision) {
//         if (bitsTotal % 2 === 0) {
//             // longitude
//             mid = (maxLng + minLng) / 2;
//             if (lng > mid) {
//                 hashValue = (hashValue << 1) + 1;
//                 minLng = mid;
//             }else {
//                 hashValue = (hashValue << 1) + 0;
//                 minLng = mid;
//             }
//         } else {
//             // latitude
//             mid = (maxLat + minLat) /2;
//             if (lat > mid) {
//                 hashValue = (hashValue << 1) + 1;
//                 minLat = mid;
//             } else {
//                 hashValue = (hashValue << 1) + 0;
//                 maxLat = mid;
//             }
//         }

//         bits++;
//         bitsTotal++;

//         if (bits === 5) {
//             geohash += BASE32.charAt(hashValue);
//             bits = 0;
//             hashValue = 0;
//         }
//     }

    return hash;
}

// Production-ready function to calculate neighboring geohashes
export function calculateNeighborGeohashes(centerGeohash: string, boundingBox: any): string[] {
    
    const precision = calculateOptimalPrecision(boundingBox);

    const truncatedHash = centerGeohash.substring(0, precision);
    
    const neighbors = geohash.neighbors(truncatedHash);
    
    return [...neighbors, truncatedHash];
}

// calc optimal precision for geohash search 
export function calculateOptimalPrecision(boundingBox: any): number {
    // Determine which geohash precision level best matches our search radius
    // For geospatial search, precision levels correspond roughly to:
    // Precision 1: ~5000km (continental)
    // Precision 2: ~1250km (country-sized)
    // Precision 3: ~156km (region-sized)
    // Precision 4: ~39km (city-sized)
    // Precision 5: ~5km (neighborhood-sized)
    // Precision 6: ~1.2km (block)
    // Precision 7: ~0.15km (cul-de-sac)
    // Precision 8: ~0.04km (YER HOUSE BRO)

    const latSpan = boundingBox.maxLat - boundingBox.minLat;
    const lngSpan = boundingBox.maxLng - boundingBox.minLng;
    const maxSpan = Math.max(latSpan, lngSpan);

    if (maxSpan >= 10) return 3; // >= 10 degrees = precision 3
    if (maxSpan > 2.5) return 4; // >2.5 degrees = precision 4
    if (maxSpan > 0.5) return 5; // >0.5 degrees = precision 5
    if (maxSpan > 0.05) return 6; // >0.05 degrees = precision 6
    return 7; // otherwise use precision 7
}