import * as placeService from '../src/services/placeService.js';

async function testDb() {
    try { 
        console.log("Testing database connection... ");

        // create a test place
        const testPlace = {
            name: "Test Coffee Shop",
            address: "123 Test St",
            location: {
                latitude: 37.7749,
                longitude: -122.4194
            },
            amenities: {
                wifi: true,
                coffee: true,
                outlets: true,
                seating: true,
                food: false,
                workspace: true,
                meetingRooms: false,
                parking: true
            },
            attributes: {
                noiseLevel: "moderate" as "moderate" | "quiet" | "loud",
                rating: 4.5,
                openLate: false,
                parking: "lot" as "lot" | "none" | "street" | "garage" | "valet",
                capacity: "medium" as "medium" | "extra-small" | "small" | "large",
                seatingComfort: 4,
                coffeeRating: 5
            },
            openingHours: [
                { day: "monday" as "monday", open: "08:00", close: "18:00" },
                { day: "tuesday" as "tuesday", open: "08:00", close: "18:00" }
            ],
            photos: ["test-coffee-shop.jpg"]
        };

        console.log("Creating test place...");
        const created = await placeService.createPlace(testPlace);
        console.log("Create:", created);

        console.log("Fetching all places...");
        const places = await placeService.getAllPlaces();
        console.log("Places:", places);

        console.log("Test completed successfully!");
    } catch (error) {
        console.error("Test failed: ", error);
    }
}

testDb();