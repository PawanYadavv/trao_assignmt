import { MongoClient, type Db } from "mongodb";

const uri = process.env.MONGODB_URI;
const databaseName = process.env.MONGODB_DB_NAME ?? "prepwise";

const globalForMongo = globalThis as typeof globalThis & {
  prepwiseMongo?: { client: MongoClient; promise?: Promise<MongoClient> };
};

const client = globalForMongo.prepwiseMongo?.client ?? new MongoClient(uri ?? "mongodb://127.0.0.1:27017", {
  tls: Boolean(uri?.startsWith("mongodb+srv://")),
  serverSelectionTimeoutMS: 10000,
  connectTimeoutMS: 10000,
});

if (process.env.NODE_ENV !== "production") {
  globalForMongo.prepwiseMongo = { client, promise: globalForMongo.prepwiseMongo?.promise };
}

export async function getDatabase(): Promise<Db> {
  if (!uri && process.env.NODE_ENV === "production") {
    throw new Error("MONGODB_URI is required in production.");
  }
  const connection = globalForMongo.prepwiseMongo?.promise ?? client.connect();
  if (process.env.NODE_ENV !== "production") globalForMongo.prepwiseMongo = { client, promise: connection };
  return (await connection).db(databaseName);
}
