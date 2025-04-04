// Simple in-memory database for local development
import { v4 as uuidv4 } from 'uuid';
import localdata from './local-data.json' with { type: "json" };
import { encodeGeohash } from '../services/placeService.js';

class LocalDatabase {
    private storage: Map<string, Map<string, any>> = new Map();

    async clearAll(): Promise<void> {
        this.storage = new Map();
        console.log('[LocalDB].. All data cleared');
    }

    // init a table if it doesn't exist
    private ensureTable(tableName: string): Map<string, any> {
        if (!this.storage.has(tableName)) {
            this.storage.set(tableName, new Map());
        }
        return this.storage.get(tableName)!;
    }

    // put an item in a table
    async putItem(tableName: string, item: Record<string, any>): Promise<void> {
        const table = this.ensureTable(tableName);
        if (!item.id) {
            throw new Error('Item must have an id field');
        }
        // If this is a place item with location but missing geohash, add it
        if (tableName === 'workbru-places' && 
            item.location?.latitude !== undefined && 
            item.location?.longitude !== undefined) {
            
            // Only generate if not already provided
            if (!item.geohash) {
                item.geohash = encodeGeohash(item.location.latitude, item.location.longitude);
            }
            
            // Only generate if not already provided
            if (!item.geohashPrefix) {
                item.geohashPrefix = item.geohash.substring(0, 4);
            }
        }
        table.set(item.id, { ...item });
        console.log(`[LocalDB] Added item to ${tableName}:`, item.id);
    }

    // You could also add an updateItem method that preserves geohashes
    async updateItem(tableName: string, key: Record<string, any>, updates: Record<string, any>): Promise<Record<string, any> | null> {
        const item = await this.getItem(tableName, key);
        if (!item) {
            return null;
        }
        
        // Create updated item
        const updatedItem: Record<string, any> = { ...item, ...updates, updatedAt: new Date().toISOString() };
        
        // If location was updated, recalculate geohashes
        if (updates.location && 
            (updates.location.latitude !== item.location?.latitude || 
             updates.location.longitude !== item.location?.longitude)) {
            
            updatedItem.geohash = encodeGeohash(updatedItem.location.latitude, updatedItem.location.longitude);
            updatedItem.geohashPrefix = updatedItem.geohash.substring(0, 4);
        }
        
        // Save updated item
        await this.putItem(tableName, updatedItem);
        return updatedItem;
    }

    // get an item from a table
    async getItem(tableName: string, key: Record<string, any>): Promise<Record<string, any> | null> {
        const table = this.ensureTable(tableName);
        const id = key.id;
        if (!id) {
            throw new Error('Key must have an id field');
        }
        const item = table.get(id);
        console.log(`[LocalDB] Retrieved item from ${tableName}:`, id, item ? 'found' : 'not found');
        return item ? { ...item } : null;
    }

    // query items (simplified - just returns all items that match a basic filter) 
    async queryItems(
        tableName: string,
        keyConditionExpression: string,
        expressionAttributeValues: Record<string, any>
    ): Promise<Record<string, any>[]> {
        return this.scanItems(tableName);
    }

    // scan all items in a table
    async scanItems(tableName: string): Promise<Record<string, any>[]> {
        const table = this.ensureTable(tableName);
        const items = Array.from(table.values());
        console.log(`[LocalDB] Scanned ${tableName}, found ${items.length} items`);
        return items;
    }

    // delete an item 
    async deleteItem(tableName: string, key: Record<string, any>): Promise<void> {
        const table = this.ensureTable(tableName);
        if (!key.id) {
            throw new Error('Key must have an id field');
        }
        table.delete(key.id);
        console.log(`[LocalDB] Deleted item from ${tableName}:`, key.id);
    }

    // load sample data 
    async initializeWithSampleData(): Promise<void> {
        const placesTable = 'workbru-places';
        const now = new Date().toISOString();

        for (const place of localdata) {
            const id = uuidv4();
            const placeWithId = { 
                ...place, 
                id, 
                createdAt: now, 
                updatedAt: now 
            };
            await this.putItem(placesTable, placeWithId);

        }
        console.log('[LocalDB] Sample data initialization complete');
    }

}

// create the singleton instance
export const localDb = new LocalDatabase();

// initialize with sample data when the module is loaded
const initializeData = async () => {
    // only in development
    if (process.env.NODE_ENV !== 'production') {
        try {
            await localDb.initializeWithSampleData();
        } catch (err) {
            console.error('[LocalDB] Error initializing sample data:', err);
        }
    }
};

// run the initialization immediately
initializeData();