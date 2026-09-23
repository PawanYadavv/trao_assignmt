import crypto from "node:crypto";
import { promisify } from "node:util";
import { getDatabase } from "./db";

export interface PublicUser {
  id: string;
  name: string;
  email: string;
}

export interface UserRecord extends PublicUser {
  passwordHash: string;
  createdAt: string;
}

export const SESSION_COOKIE = "prepwise_session";
const SESSION_DAYS = 7;
const scryptAsync = promisify(crypto.scrypt);

function publicUser(user: UserRecord): PublicUser {
  return { id: user.id, name: user.name, email: user.email };
}

export async function hashPassword(password: string) {
  const salt = crypto.randomBytes(16).toString("hex");
  const derived = await scryptAsync(password, salt, 64) as Buffer;
  return `scrypt$${salt}$${derived.toString("hex")}`;
}

async function passwordMatches(password: string, stored: string) {
  if (!stored.startsWith("scrypt$")) return crypto.createHash("sha256").update(password).digest("hex") === stored;
  const [, salt, expected] = stored.split("$");
  const derived = await scryptAsync(password, salt, 64) as Buffer;
  return crypto.timingSafeEqual(Buffer.from(expected, "hex"), derived);
}

export async function registerUser(input: { name: string; email: string; password: string }) {
  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  if (!name || !email || input.password.length < 6) {
    throw new Error("Name, email, and a password with at least 6 characters are required.");
  }

  const database = await getDatabase();
  const users = database.collection<UserRecord>("users");
  const existing = await users.findOne({ email });
  if (existing) throw new Error("A user with that email already exists.");

  const user: UserRecord = {
    id: crypto.randomUUID(),
    name,
    email,
    passwordHash: await hashPassword(input.password),
    createdAt: new Date().toISOString(),
  };
  await users.insertOne(user);
  return publicUser(user);
}

export async function loginUser(input: { email: string; password: string }) {
  const email = input.email.trim().toLowerCase();
  const database = await getDatabase();
  const user = await database.collection<UserRecord>("users").findOne({ email });
  if (!user || !(await passwordMatches(input.password, user.passwordHash))) return null;
  return publicUser(user);
}

export async function createSession(userId: string) {
  const token = crypto.randomUUID();
  const expiresAt = new Date(Date.now() + 1000 * 60 * 60 * 24 * SESSION_DAYS);
  const database = await getDatabase();
  await database.collection("sessions").insertOne({ token, userId, expiresAt });
  return token;
}

function sessionToken(request: Request) {
  return request.headers.get("cookie")
    ?.split(";")
    .map((entry) => entry.trim())
    .find((entry) => entry.startsWith(`${SESSION_COOKIE}=`))
    ?.replace(`${SESSION_COOKIE}=`, "");
}

export async function getCurrentUser(request: Request) {
  const token = sessionToken(request);
  if (!token) return null;

  const database = await getDatabase();
  const session = await database.collection<{ token: string; userId: string; expiresAt: Date }>("sessions").findOne({ token });
  if (!session || session.expiresAt.getTime() < Date.now()) {
    if (session) await database.collection("sessions").deleteOne({ token });
    return null;
  }

  const user = await database.collection<UserRecord>("users").findOne({ id: session.userId });
  return user ? publicUser(user) : null;
}

export async function clearSession(request: Request) {
  const token = sessionToken(request);
  if (!token) return;
  const database = await getDatabase();
  await database.collection("sessions").deleteOne({ token });
}
