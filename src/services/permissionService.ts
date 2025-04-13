import * as userService from './userService.js';
import * as placeService from './placeService.js';

export enum Permission {
    READ_PLACE = 'READ_PLACE',
    CREATE_PLACE = 'CREATE_PLACE',
    UPDATE_PLACE = 'UPDATE_PLACE',
    DELETE_PLACE = 'DELETE_PLACE',
    MANAGE_USERS = 'MANAGE_USERS'
}

/**
 * Checks if a user has a specific permission
 */
export async function hasPermission(userId: string, permission: Permission, resourceId?: string): Promise<boolean> {
    // if no user ID, no permissions
    if (!userId) return false;

    try {
        // check if user is admin 
        const isAdmin = await isUserAdmin(userId);
        if (isAdmin) return true;

        // for non-admins, implement specific permission logic
        switch (permission) {
            case Permission.READ_PLACE:
                // anyone authenticated can read places
                return true;

            case Permission.CREATE_PLACE: 
                // only admins can create places
                return false;

            case Permission.UPDATE_PLACE:
            case Permission.DELETE_PLACE:
                if (!resourceId) return false;

                // check if user is the creator of the place
                const place = await placeService.getPlaceById(resourceId);
                return place?.createdBy === userId;

            case Permission.MANAGE_USERS: 
                // only admins can manage users
                return false;

            default: 
                return false;
        }
    } catch (error) {
        console.error(`Error checking permissions for user ${userId}:`, error);
        return false; // Fail closed - deny access on error
    }
}

/**
 * Checks if user has admin priv
 */
export async function isUserAdmin(userId: string): Promise<boolean> {
    try {
        console.log(`Checking admin status for user ${userId} via database lookup`);
        
        // This function should handle both username and UUID lookups
        const user = await userService.getUserByIdOrUsername(userId);
        
        if (!user) {
            console.log(`No user found for ${userId}`);
            return false;
        }

        console.log(`User attributes for ${userId}:`, user.attributes);
        
        // Check custom.isAdmin attribute
        const isAdmin = 
            (user.attributes['custom:isAdmin'] === 'true') || 
            (user.attributes.isAdmin === 'true');
        
        console.log(`Admin check result for ${userId}: ${isAdmin}`);
        return isAdmin;
    } catch (error) {
        console.error(`Error checking admin status for user ${userId}:`, error);
        return false; // Fail closed - deny admin access on error
    }
}