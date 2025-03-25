import { describe, it, expect, beforeAll, afterEach, mock, spyOn } from "bun:test";
import { 
    calculateOptimalPrecision, 
    calculateNeighborGeohashes, 
    calculateDistance, 
    getPlacesNearby,
    encodeGeohash,
    calculateBoundingBox,
    createPlace,
    getPlaceById,
    updatePlace,
    deletePlace
} from "../src/services/placeService.js";
import * as dynamodb from "../src/utils/dynamodb.js";

describe("PlaceService Tests", () => {
    it("should calculate correct geohash precision based on search radius", () => {
        const boundingBox1 = { minLat: 0, maxLat: 1, minLng: 0, maxLng: 1 }; // ~111km
        const boundingBox2 = { minLat: 0, maxLat: 10, minLng: 0, maxLng: 10 }; // ~1110km
        const boundingBox3 = { minLat: 0, maxLat: 0.1, minLng: 0, maxLng: 0.1 }; // ~11km

        expect(calculateOptimalPrecision(boundingBox1)).toBe(5); // ~5km precision
        expect(calculateOptimalPrecision(boundingBox2)).toBe(3); // ~156km precision
        expect(calculateOptimalPrecision(boundingBox3)).toBe(6); // ~1.2km precision
    });

    it("should generate correct neighbor geohashes", () => {
        const centerGeohash = "9q8yy";
        const boundingBox = { minLat: 37, maxLat: 38, minLng: -123, maxLng: -122 };

        const neighbors = calculateNeighborGeohashes(centerGeohash, boundingBox);
        expect(neighbors).toContain("9q8yy"); // Center geohash
        expect(neighbors.length).toBeGreaterThan(1); // Includes neighbors
    });

    it("should calculate accurate distances between two points", () => {
        const distance1 = calculateDistance(37.7749, -122.4194, 37.7749, -122.4194); // Same point
        const distance2 = calculateDistance(37.7749, -122.4194, 34.0522, -118.2437); // SF to LA

        expect(distance1).toBe(0); // Same point, distance is 0
        expect(distance2).toBeCloseTo(559, 0); // Approximate distance in km
    });

    it("should filter places correctly based on distance", async () => {
        const lat = 37.7749;
        const lng = -122.4194;
        const radiusKm = 10;

        const places = await getPlacesNearby(lat, lng, radiusKm);

        expect(places.every(place => place.distance! <= radiusKm)).toBe(true); // All places within radius
        expect(places).toBeInstanceOf(Array); // Should return an array
        if (places.length > 1) {
            expect(places[0].distance).toBeLessThanOrEqual(places[1].distance!); // Sorted by distance
        }
    });

    // Geohash encoding tests
    it("should encode coordinates to geohash correctly", () => {
        // Known geohash values for testing
        expect(encodeGeohash(37.7749, -122.4194, 5)).toBe("9q8yy");
        expect(encodeGeohash(40.7128, -74.0060, 5)).toBe("dr5rs");
        expect(encodeGeohash(51.5074, -0.1278, 5)).toBe("gcpvj");

        // Test precision parameter
        expect(encodeGeohash(37.7749, -122.4194, 3)).toBe("9q8");
        expect(encodeGeohash(37.7749, -122.4194, 6)).toBe("9q8yyn");
    });

    it("should verify that nearby points have similar geohash prefixes", () => {
        // Two points very close to each other
        const hash1 = encodeGeohash(37.7749, -122.4194, 7); // San fran
        const hash2 = encodeGeohash(37.7740, -122.4195, 7); // just a few meters away

        // they should share at least the first 5 chars
        expect(hash1.substring(0, 5)).toBe(hash2.substring(0, 5));

        // points further away should have different prefixes at some level
        const hash3 = encodeGeohash(37.8, -122.5, 7); // a bit further
        expect(hash1.substring(0, 4)).not.toBe(hash3.substring(0, 4));
    });

    // Bounding bos tests
    it("should calculate bounding box correctly  for different latitudes", () => {
        // Equator(0°) - 10km radius
        const equatorBox = calculateBoundingBox(0, 0, 10);

        // should be roughly equal spans in both directions at the equator
        const equatorLatSpan = equatorBox.maxLat - equatorBox.minLat;
        const equatorLngSpan = equatorBox.maxLng - equatorBox.minLng;
        expect(equatorLatSpan).toBeCloseTo(equatorLngSpan, 1);

        // near the pole (80°) - 10km radius
        const polarBox = calculateBoundingBox(80, 0, 10);

        // Longitude span should be much larger than latitude span near the poles
        const polarLatSpan = polarBox.maxLat - polarBox.minLat;
        const polarLngSpan = polarBox.maxLng - polarBox.minLng;
        expect(polarLatSpan).toBeLessThan(polarLngSpan * 3);
    });
    
    // Test the radius is correctly represented
    it("should calculate bounding box that covers the specified radius", () => {
        const lat = 37.7749;
        const lng = -122.4194;
        const radius = 10; // km 

        const box = calculateBoundingBox(lat, lng, radius);

        // check diagonal distance from center to corner
        const cornerDistance = calculateDistance(
            lat, lng, 
            box.maxLat, box.maxLng
        );

        // diagonal should be at least the radius (actually sqrt(2) * radius)
        expect(cornerDistance).toBeGreaterThanOrEqual(radius);
        // but not too much larger (allowing for earth cruvature effects)
        expect(cornerDistance).toBeLessThanOrEqual(1.5 * radius);
    });

    // Mock dependencies for CRUD tests
    beforeAll(() => {
        // Mock dynamodb functions
        mock.module("../src/utils/dynamodb.js", () => ({
            putItem: mock(() => Promise.resolve()),
            getItem: mock((table, key) => {
                if (key.id === "test-id") {
                    return Promise.resolve({
                        id: "test-id",
                        name: "Test Place",
                        address: "123 Test St",
                        location: { latitude: 37.7749, longitude: -122.4194 },
                        geohash: "9q8yyn",
                        amenities: { wifi: true, coffee: true},
                        attributes: { noiseLevel: "quiet", parking: "none" },
                        createdAt: "2023-01-01T00:00:00Z",
                        updatedAt: "2023-01-01T00:00:01Z"
                    });
                }
                return Promise.resolve(null);
            }),
            scanItems: mock(() => Promise.resolve([
                {id: "test-id", name: "Test Place" },
                {id: "test-id-2", name: "Another Place" }
            ])),
            deleteItem: mock(() => Promise.resolve()),
            PLACES_TABLE: "workbrew-places"
        }));
    });

    // Clean up mocks
    afterEach(() => {
        mock.restore();
    });

    // CRUD tests 
    it("should create a place with correct data and geohash", async () => {
        const placeData = {
            name: "New Coffee Shop",
            address: "456 Coffee St",
            location: { latitude: 37.7749, longitude: -122.4194 },
            amenities: { 
                wifi: true, 
                coffee: true, 
                outlets: true, 
                seating: true, 
                food: false, 
                meetingRooms: false 
            },
            attributes: { 
                noiseLevel: "moderate" as const,
                parking: "street" as const,
                openLate: false
            }
        };
         const newPlace = await createPlace(placeData);

         expect(newPlace.id).toBeDefined();
         expect(newPlace.name).toBe(placeData.name);
         expect(newPlace.geohash).toBe(encodeGeohash(37.7749, -122.4194));
         expect(newPlace.createdAt).toBeDefined();
         expect(newPlace.updatedAt).toBeDefined();
    });

    it("should get a place by ID and cache it", async () => {
        const spyGetItem = spyOn(dynamodb, "getItem");

        // first call should hit the db
        const place1 = await getPlaceById("test-id");
        expect(place1).not.toBeNull();
        expect(place1?.name).toBe("Test Place");
        expect(spyGetItem).toHaveBeenCalledTimes(1);

        // second call should use the cache
        const place2 = await getPlaceById("test-id");
        expect(place2).not.toBeNull();
        expect(spyGetItem).toHaveBeenCalledTimes(1); // still just one call to getItem
    });

    it("should update a place correctly", async () => {
        const updateData = {
            name: "Updated Place Name",
            amenities: { wifi: false }
        };

        const updated = await updatePlace("test-id", updateData);

        expect(updated).not.toBeNull();
        expect(updated?.name).toBe(updateData.name);
        expect(updated?.amenities.wifi).toBe(false);
        // original data should be preserved
        expect(updated?.address).toBe("123 Test st");
    })

    it("should delete a place correctly", async () => {
        const result = await deletePlace("test-id");
        expect(result).toBe(true);

        // non-existent ID
        const result2 = await deletePlace("non-existent");
        expect(result2).toBe(false);
    });

    // error handling tests
    it("should handle errors in getPlacesNearby graacefully", async => {
        // force an error
        mock.module("../src/utils/dynamodb.js", () => ({
            queryItems: () => Promise.reject(new Error("Simulated error"))
        }));
        await expect(getPlacesNearby(37.7749, -122.4194, 10))
            .rejects
            .toThrow("Failed to fetch nearby places");
    })


});
