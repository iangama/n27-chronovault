import express from "express";
import pg from "pg";
import { Worker } from "bullmq";
import promClient from "prom-client";

const { Pool } = pg;

const pool = new Pool({
  host: process.env.PGHOST || "postgres",
  port: Number(process.env.PGPORT || 5432),
  database: process.env.POSTGRES_DB || "chronovault",
  user: process.env.POSTGRES_USER || "postgres",
  password: process.env.POSTGRES_PASSWORD || "postgres",
  max: 10
});

promClient.collectDefaultMetrics({ prefix: "chronovault_worker_" });
const projected = new promClient.Counter({
  name: "chronovault_worker_projected_events_total",
  help: "Projected events total",
  labelNames: ["type"]
});

async function applyEvent(event_id) {
  const { rows } = await pool.query("SELECT id,ts,type,capsule_id,payload FROM es_events WHERE id=$1", [event_id]);
  if (!rows.length) return { ok:false, error:"event_not_found" };
  const e = rows[0];

  if (e.type === "capsule.created") {
    const p = e.payload || {};
    await pool.query(
      `INSERT INTO pr_capsules(id,title,payload,tags,seal_level,status,created_at,last_event_id)
       VALUES($1,$2,$3,$4,$5,'open',$6,$7)
       ON CONFLICT (id) DO UPDATE SET
         title=EXCLUDED.title,
         payload=EXCLUDED.payload,
         tags=EXCLUDED.tags,
         seal_level=EXCLUDED.seal_level,
         last_event_id=EXCLUDED.last_event_id`,
      [
        e.capsule_id,
        String(p.title || "Untitled"),
        p.payload || {},
        Array.isArray(p.tags) ? p.tags : [],
        Number(p.seal_level || 1),
        e.ts,
        e.id
      ]
    );
  }

  if (e.type === "capsule.sealed") {
    await pool.query(
      `UPDATE pr_capsules
       SET status='sealed', sealed_at=COALESCE(sealed_at,$2), last_event_id=$3
       WHERE id=$1`,
      [e.capsule_id, e.ts, e.id]
    );
  }

  projected.inc({ type: e.type });
  return { ok:true };
}

new Worker(
  "chronovault_project",
  async (job) => {
    const r = await applyEvent(job.data.event_id);
    if (!r.ok) throw new Error(r.error || "apply_failed");
    return r;
  },
  { connection: { host: "redis", port: 6379 }, concurrency: 4 }
);

const app = express();
app.get("/health", async (req, res) => {
  try { await pool.query("SELECT 1"); res.json({ ok:true, service:"chronovault-worker" }); }
  catch { res.status(503).json({ ok:false }); }
});
app.get("/metrics", async (req, res) => {
  res.set("Content-Type", promClient.register.contentType);
  res.send(await promClient.register.metrics());
});
app.listen(3001, () => console.log("[chronovault-worker] up :3001"));
