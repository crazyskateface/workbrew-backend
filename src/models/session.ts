import { z } from 'zod';

// Schema validation using Zod
export const SessionSchema = z.object({
    sessionId: z.string().uuid(),
    userId: z.string(),
    username: z.string(),
    csrfToken: z.string(),
    userAgent: z.string().optional(),
    ipAddress: z.string().optional(),
    issuedAt: z.number(),  // Unix timestamp when the session was created
    expiresAt: z.number(), // Unix timestamp when the session expires
    lastRotatedAt: z.number().optional(), // When the CSRF token was last rotated
    lastActivityAt: z.number().optional(), // When the session was last active
    isValid: z.boolean().default(true),
    additionalData: z.record(z.any()).optional() // For storing any other session-related data
});

export type Session = z.infer<typeof SessionSchema>;