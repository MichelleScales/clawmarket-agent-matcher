// Refresh the MongoDB catalog from the live ClawMarket API — no embeddings.
//   npm run sync
// Designed to run on a schedule (e.g. cron every 15 min). Unlike `seed`, this
// does NOT call Gemini, so it runs fine in regions where the embedding API is
// unavailable. It upserts every live skill (preserving any existing `embedding`
// field so Atlas Vector Search keeps working) and removes skills that are no
// longer in the live catalog. The agent path (MCP `find` over the collection)
// picks up new/changed skills immediately.

import { MongoClient } from "mongodb";
import { fetchLiveCatalog } from "../lib/catalog";

function loadEnvFile() {
  const fs = require("fs") as typeof import("fs");
  const path = require("path") as typeof import("path");
  const file = path.resolve(process.cwd(), ".env");
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    const key = m[1];
    let val = m[2].trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = val;
  }
}

async function main() {
  loadEnvFile();

  const uri = process.env.MONGODB_URI;
  const dbName = process.env.MONGODB_DB || "clawmarket";
  const collName = process.env.MONGODB_COLLECTION || "skills";
  const stamp = new Date().toISOString();

  if (!uri) {
    console.error(`[${stamp}] ✗ MONGODB_URI not set`);
    process.exit(1);
  }

  const skills = await fetchLiveCatalog();
  if (skills.length === 0) {
    console.error(`[${stamp}] ✗ live catalog returned 0 skills — aborting (won't wipe DB)`);
    process.exit(1);
  }

  const client = new MongoClient(uri);
  await client.connect();
  try {
    const coll = client.db(dbName).collection(collName);

    // Upsert each skill, leaving any existing `embedding` untouched.
    const ops = skills.map((s) => {
      const { embedding: _ignore, ...fields } = s;
      return {
        updateOne: {
          filter: { skill_id: s.skill_id },
          update: { $set: fields },
          upsert: true,
        },
      };
    });
    const res = await coll.bulkWrite(ops, { ordered: false });

    // Drop skills that are no longer live.
    const liveIds = skills.map((s) => s.skill_id);
    const removed = await coll.deleteMany({ skill_id: { $nin: liveIds } });

    // Idempotent — keeps indexes in place for fresh collections.
    await coll.createIndex(
      { skill_name: "text", description: "text", best_for: "text", tags: "text", agent_name: "text" },
      { name: "skill_search" },
    );
    await coll.createIndex({ skill_id: 1 }, { unique: true });

    const total = await coll.countDocuments();
    console.log(
      `[${stamp}] ✓ sync ok — live=${skills.length} upserted=${res.upsertedCount} ` +
        `modified=${res.modifiedCount} removed=${removed.deletedCount} total=${total}`,
    );
  } finally {
    await client.close();
  }
}

main().catch((err) => {
  console.error(`[${new Date().toISOString()}] ✗ sync failed:`, err instanceof Error ? err.message : err);
  process.exit(1);
});
