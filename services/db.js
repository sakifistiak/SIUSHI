const fs = require('fs');
const path = require('path');
const { MongoClient } = require('mongodb');

const DATA_DIR = path.join(__dirname, '..', 'data');
if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
}

let mongoClient = null;
let mongoDb = null;
let isConnectedToMongo = false;

// Standard Dhaka Timezone Date Helpers
function getDhakaDateString(d = new Date()) {
    return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Dhaka' });
}

function getDhakaMonthString(d = new Date()) {
    return getDhakaDateString(d).substring(0, 7);
}

function bengaliToEnglishDigits(str) {
    if (!str) return '';
    const bn = ['০', '১', '২', '৩', '৪', '৫', '৬', '৭', '৮', '৯'];
    return String(str).replace(/[০-৯]/g, d => bn.indexOf(d));
}

function getLocalFilePath(collectionName) {
    if (collectionName === 'reminders') {
        return path.join(__dirname, '..', 'data.json');
    }
    return path.join(DATA_DIR, `${collectionName}.json`);
}

function readLocalCollection(collectionName, defaultVal = []) {
    const filePath = getLocalFilePath(collectionName);
    if (!fs.existsSync(filePath)) {
        writeLocalCollection(collectionName, defaultVal);
        return defaultVal;
    }
    try {
        const raw = fs.readFileSync(filePath, 'utf-8');
        return JSON.parse(raw);
    } catch (e) {
        return defaultVal;
    }
}

function writeLocalCollection(collectionName, data) {
    const filePath = getLocalFilePath(collectionName);
    const dir = path.dirname(filePath);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

/**
 * Initializes Database Connection (MongoDB Atlas or Local Persistent JSON)
 */
async function initDatabase() {
    let uri = process.env.MONGODB_URI;

    // Check if URI is saved in local settings
    if (!uri) {
        try {
            const settings = readLocalCollection('settings', {});
            if (settings.mongoUri) uri = settings.mongoUri;
        } catch (e) {}
    }

    if (uri && !isConnectedToMongo) {
        try {
            console.log('[Database] Connecting to MongoDB Atlas...');
            mongoClient = new MongoClient(uri, { serverSelectionTimeoutMS: 8000 });
            await mongoClient.connect();
            mongoDb = mongoClient.db();
            isConnectedToMongo = true;
            console.log(`[Database] Connected successfully to MongoDB: "${mongoDb.databaseName}"!`);

            // Auto-migrate local data to MongoDB if MongoDB collection is empty
            await autoMigrateLocalData();
        } catch (err) {
            console.warn('[Database] MongoDB connection failed, falling back to local storage:', err.message);
            isConnectedToMongo = false;
        }
    }
}

async function autoMigrateLocalData() {
    if (!isConnectedToMongo || !mongoDb) return;
    const collections = ['users', 'finance', 'dues', 'clients', 'urgent', 'settings', 'reminders'];

    for (const colName of collections) {
        try {
            const count = await mongoDb.collection(colName).countDocuments();
            if (count === 0) {
                const localData = readLocalCollection(colName, null);
                if (localData) {
                    if (Array.isArray(localData) && localData.length > 0) {
                        await mongoDb.collection(colName).insertMany(localData);
                        console.log(`[Database] Migrated ${localData.length} records for collection "${colName}" to MongoDB.`);
                    } else if (localData.transactions && Array.isArray(localData.transactions) && localData.transactions.length > 0) {
                        await mongoDb.collection(colName).insertMany(localData.transactions);
                        console.log(`[Database] Migrated ${localData.transactions.length} finance transactions to MongoDB.`);
                    } else if (localData.users && Array.isArray(localData.users) && localData.users.length > 0) {
                        await mongoDb.collection(colName).insertMany(localData.users);
                        console.log(`[Database] Migrated ${localData.users.length} users to MongoDB.`);
                    } else if (typeof localData === 'object' && Object.keys(localData).length > 0) {
                        await mongoDb.collection(colName).insertOne({ _id: 'config', ...localData });
                    }
                }
            }
        } catch (err) {
            console.error(`[Database Migration Error for ${colName}]:`, err.message);
        }
    }
}

/**
 * Universal Data Read
 */
async function loadCollection(collectionName, defaultVal = []) {
    if (isConnectedToMongo && mongoDb) {
        try {
            if (collectionName === 'settings') {
                const doc = await mongoDb.collection(collectionName).findOne({ _id: 'config' });
                if (doc) {
                    delete doc._id;
                    return doc;
                }
                return defaultVal;
            }
            const docs = await mongoDb.collection(collectionName).find({}).toArray();
            return docs.map(d => {
                delete d._id;
                return d;
            });
        } catch (err) {
            console.warn(`[MongoDB Read Error on ${collectionName}]:`, err.message);
        }
    }
    return readLocalCollection(collectionName, defaultVal);
}

/**
 * Universal Data Write
 */
async function saveCollection(collectionName, data) {
    // Always persist to local file as secondary fallback
    writeLocalCollection(collectionName, data);

    if (isConnectedToMongo && mongoDb) {
        try {
            if (collectionName === 'settings') {
                await mongoDb.collection(collectionName).updateOne(
                    { _id: 'config' },
                    { $set: data },
                    { upsert: true }
                );
                return;
            }

            const items = Array.isArray(data) ? data : (data.transactions || data.users || data.dues || data.clients || data.reminders || []);
            await mongoDb.collection(collectionName).deleteMany({});
            if (items.length > 0) {
                await mongoDb.collection(collectionName).insertMany(items);
            }
        } catch (err) {
            console.error(`[MongoDB Write Error on ${collectionName}]:`, err.message);
        }
    }
}

/**
 * Full Snapshot Export for 1-Click Backup
 */
async function exportFullSnapshot() {
    const collections = ['users', 'finance', 'dues', 'clients', 'urgent', 'settings', 'reminders'];
    const snapshot = {
        exportedAt: new Date().toISOString(),
        version: '2.4.0',
        databaseEngine: isConnectedToMongo ? 'MongoDB Atlas' : 'Local JSON'
    };

    for (const col of collections) {
        snapshot[col] = await loadCollection(col, []);
    }
    return snapshot;
}

/**
 * Full Snapshot Restore
 */
async function restoreFullSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') {
        return { success: false, error: 'Invalid snapshot data structure.' };
    }

    const collections = ['users', 'finance', 'dues', 'clients', 'urgent', 'settings', 'reminders'];
    let restoredCount = 0;

    for (const col of collections) {
        if (snapshot[col] !== undefined) {
            await saveCollection(col, snapshot[col]);
            restoredCount++;
        }
    }

    return { success: true, restoredCollections: restoredCount };
}

// Auto-boot DB
initDatabase().catch(err => console.warn('[Database Init]:', err.message));

module.exports = {
    initDatabase,
    loadCollection,
    saveCollection,
    readLocalCollection,
    writeLocalCollection,
    exportFullSnapshot,
    restoreFullSnapshot,
    getDhakaDateString,
    getDhakaMonthString,
    bengaliToEnglishDigits,
    isMongoConnected: () => isConnectedToMongo,
    getDatabaseInfo: () => ({
        connected: isConnectedToMongo,
        type: isConnectedToMongo ? 'MongoDB Atlas (Persistent Cloud)' : 'Local File Storage (Ephemeral on Render)',
        name: isConnectedToMongo ? mongoDb?.databaseName : 'Local'
    })
};
