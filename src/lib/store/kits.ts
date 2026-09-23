/**
 * Kit persistence. The only module that knows how a kit is stored.
 *
 * Kits are per-user documents with their own id, so a user can hold several
 * kits at once and reopen any of them later. Every read is scoped by userId, so
 * a user can only ever reach their own.
 */

import crypto from "node:crypto";
import { getDatabase } from "@/lib/db";
import type { Kit, KitRecord } from "@/lib/kit/types";

const COLLECTION = "kits";

export interface KitSummary {
  id: string;
  title: string;
  company: string;
  role: string;
  days: number;
  questionCount: number;
  uncoveredCount: number;
  createdAt: string;
  updatedAt: string;
}

export function fingerprintFor(input: { jd: string; company_url: string; days: number }) {
  return crypto
    .createHash("sha256")
    .update(`${input.jd.trim()}\u0000${input.company_url.trim().toLowerCase()}\u0000${input.days}`)
    .digest("hex");
}

function titleFor(kit: Kit) {
  const role = kit.role.title && kit.role.title !== "Not specified" ? kit.role.title : "Interview kit";
  return `${role} - ${kit.source.company}`.slice(0, 120);
}

export function summarise(record: KitRecord): KitSummary {
  return {
    id: record.id,
    title: record.title,
    company: record.kit.source.company,
    role: record.kit.role.title,
    days: record.kit.schedule.days_available,
    questionCount: record.kit.questions.length,
    uncoveredCount: record.kit.coverage.uncovered_requirement_ids.length,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt,
  };
}

async function collection() {
  const database = await getDatabase();
  return database.collection<KitRecord>(COLLECTION);
}

export async function listKits(userId: string): Promise<KitSummary[]> {
  const kits = await collection();
  const records = await kits.find({ userId }, { projection: { _id: 0 } }).sort({ updatedAt: -1 }).toArray();
  return records.map(summarise);
}

export async function getKit(userId: string, id: string): Promise<KitRecord | null> {
  const kits = await collection();
  return kits.findOne({ userId, id }, { projection: { _id: 0 } });
}

export async function findByFingerprint(userId: string, fingerprint: string): Promise<KitRecord | null> {
  const kits = await collection();
  return kits.findOne({ userId, fingerprint }, { projection: { _id: 0 } });
}

export async function createKit(
  userId: string,
  kit: Kit,
  fingerprint: string,
): Promise<KitRecord> {
  const now = new Date().toISOString();
  const record: KitRecord = {
    id: crypto.randomUUID(),
    userId,
    title: titleFor(kit),
    kit,
    createdAt: now,
    updatedAt: now,
    fingerprint,
  };
  const kits = await collection();
  await kits.insertOne({ ...record });
  return record;
}

/** Replaces the kit body of a record the user owns. Returns null if not theirs. */
export async function updateKit(userId: string, id: string, kit: Kit): Promise<KitRecord | null> {
  const kits = await collection();
  const updatedAt = new Date().toISOString();
  const result = await kits.findOneAndUpdate(
    { userId, id },
    { $set: { kit, title: titleFor(kit), updatedAt } },
    { returnDocument: "after", projection: { _id: 0 } },
  );
  return result ?? null;
}

export async function deleteKit(userId: string, id: string): Promise<boolean> {
  const kits = await collection();
  const result = await kits.deleteOne({ userId, id });
  return result.deletedCount > 0;
}
