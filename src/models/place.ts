import { z } from 'zod';

// Schema validation using Zod
export const PlaceSchema = z.object({
    id: z.string().uuid().optional(),
    name: z.string().min(1).max(100),
    description: z.string().max(1000).optional(),
    address: z.string().min(1),
    location: z.object({
        latitude: z.number(),
        longitude: z.number(),
    }),
    geohash: z.string().optional(),
    distance: z.number().optional(), // for storing calculated distance
    amenities: z.object({
        wifi: z.boolean().default(false),
        coffee: z.boolean().default(false),
        outlets: z.boolean().default(false),
        seating: z.boolean().default(false),
        food: z.boolean().default(false),
        meetingRooms: z.boolean().default(false),
        
    }),
    attributes: z.object({
        parking: z.enum(['none', 'street', 'lot', 'garage', 'valet']).default('none'),
        capacity: z.enum(['extra-small', 'small', 'medium', 'large']).optional(), 
        noiseLevel: z.enum(['quiet', 'moderate', 'loud']),
        seatingComfort: z.number().min(1).max(5).optional(),
        rating: z.number().min(0).max(5).optional(),
        openLate: z.boolean().default(false),
        coffeeRating: z.number().min(1).max(5).optional(),

    }),
    openingHours: z.array(
        z.object({
            day: z.enum(['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday']),
            open: z.string(), // e.g., "09:00"
            close: z.string(), // e.g., "17:00"
        })
    ).optional(),
    photos: z.array(z.string()).optional(),
    googlePlaceId: z.string().optional(),
    createdAt: z.string().datetime().optional(),
    updatedAt: z.string().datetime().optional(),
});

export type Place = z.infer<typeof PlaceSchema>;