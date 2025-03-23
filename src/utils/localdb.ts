// Simple in-memory database for local development
import { v4 as uuidv4 } from 'uuid';
import localdata from './local-data.json' with { type: "json" };

class LocalDatabase {
    private storage: Map<string, Map<string, any>> = new Map();

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
        table.set(item.id, { ...item });
        console.log(`[LocalDB] Added item to ${tableName}:`, item.id);
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
        const placesTable = 'workbrew-places';
        const now = new Date().toISOString();

        for (const place of localdata) {
            const id = uuidv4();
            place.id = id;
            place.createdAt = now;
            place.updatedAt = now;
            await this.putItem(placesTable, place);

        }
        console.log('[LocalDB] Sample data initialization complete');
    }

}

// create the singleton instance
export const localDb = new LocalDatabase();

// initialize with sample data when the module is loaded
const initializeData = async () => {
    try {
        await localDb.initializeWithSampleData();
    } catch (err) {
        console.error('[LocalDB] Error initializing sample data:', err);
    }
};

// run the initialization immediately
initializeData();