import { describe, it, expect } from "bun:test";
import { calculateOptimalPrecision, calculateNeighborGeohashes, calculateDistance, getPlacesNearby } from "../src/services/placeService.js";

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
});
