import express from "express";
import helmet from "helmet";
import cors from "cors";
import morgan from "morgan";
import crypto from "crypto";
import pg from "pg";
import { createClient } from "redis";
import { Queue } from "bullmq";
import promClient from "prom-client";

const { Pool } = pg;
const app = express();
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(morgan("combined"));

const version = process.env.APP_VERSION || "27.0.0";
const salt = process.env.HASH_SALT || "chronovault-salt";

const pool = new Pool({
  host: process.env.PGHOST || "postgres",
  port: Number(process.env.PGPORT || 5432),
  database: process.env.POSTGRES_DB || "chronovault",
  user: process.env.POSTGRES_USER || "postgres",
  password: process.env.POSTGRES_PASSWORD || "postgres",
  max: 10
});

const redis = createClient({ url: "redis://redis:6379" });
await redis.connect();
const queue = new Queue("chronovault_project", { connection: { host: "redis", port: 6379 } });

promClient.collectDefaultMetrics({ prefix: "chronovault_api_" });
const httpReq = new promClient.Counter({
  name: "chronovault_api_http_requests_total",
  help: "HTTP requests total",
  labelNames: ["method", "path", "status"]
});
app.use((req, res, next) => {
  res.on("finish", () => httpReq.inc({ method: req.method, path: req.path, status: String(res.statusCode) }));
  next();
});
app.get("/metrics", async (req, res) => {
  res.set("Content-Type", promClient.register.contentType);
  res.send(await promClient.register.metrics());
});

function actorFrom(req) {
  const a = (req.header("x-actor") || "").trim();
  return a.length ? a : null;
}
function stableStringify(obj) {
  const seen = new WeakSet();
  const rec = (v) => {
    if (v && typeof v === "object") {
      if (seen.has(v)) return null;
      seen.add(v);
      if (Array.isArray(v)) return v.map(rec);
      return Object.keys(v).sort().reduce((acc, k) => (acc[k] = rec(v[k]), acc), {});
    }
    return v;
  };
  return JSON.stringify(rec(obj));
}
function sha256(s) {
  return crypto.createHash("sha256").update(s).digest("hex");
}

async function nextSeq(client, stream) {
  const { rows } = await client.query("SELECT COALESCE(MAX(stream_seq),0) AS m FROM es_events WHERE stream=$1", [stream]);
  return Number(rows[0].m) + 1;
}
async function lastHash(client, stream) {
  const { rows } = await client.query("SELECT hash FROM es_events WHERE stream=$1 ORDER BY stream_seq DESC LIMIT 1", [stream]);
  return rows.length ? rows[0].hash : "GENESIS";
}
async function appendEvent({ client, stream, type, actor, capsule_id, payload, meta }) {
  const stream_seq = await nextSeq(client, stream);
  const prev_hash = await lastHash(client, stream);

  const body = { stream, stream_seq, type, actor, capsule_id: capsule_id || null, payload: payload || {}, meta: meta || {}, prev_hash };
  const hash = sha256(`${prev_hash}|${stableStringify(body)}|${salt}`);

  const { rows } = await client.query(
    `INSERT INTO es_events(stream, stream_seq, type, actor, capsule_id, payload, meta, prev_hash, hash)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id, ts, stream_seq, hash`,
    [stream, stream_seq, type, actor, capsule_id || null, payload || {}, meta || {}, prev_hash, hash]
  );
  return rows[0];
}

async function health() {
  const out = { ok: true, service: "chronovault-api", version, ts: new Date().toISOString() };
  try { await pool.query("SELECT 1"); out.db = "ok"; } catch { out.ok=false; out.db="fail"; }
  try { out.redis = (await redis.ping()) === "PONG" ? "ok" : "fail"; if (out.redis!=="ok") out.ok=false; } catch { out.ok=false; out.redis="fail"; }
  return out;
}

app.get("/health", async (req, res) => {
  const h = await health();
  res.status(h.ok ? 200 : 503).json(h);
});

app.post("/capsules", async (req, res) => {
  const actor = actorFrom(req);
  if (!actor) return res.status(400).json({ ok:false, error:"missing x-actor" });

  const { title, payload, tags, seal_level } = req.body || {};
  if (!title || typeof title !== "string") return res.status(400).json({ ok:false, error:"title required" });
  const level = Number(seal_level);
  if (!Number.isInteger(level) || level < 1 || level > 5) return res.status(400).json({ ok:false, error:"seal_level 1..5" });

  const { rows: idRows } = await pool.query("SELECT uuid_generate_v4() AS id");
  const capsule_id = idRows[0].id;

  const meta = { rationale:"Structural command -> immutable event; state derived by projector.", unknowns:["Future policies may change; keep social powerless."] };

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const eG = await appendEvent({ client, stream:"global", type:"capsule.created", actor, capsule_id, payload:{ title, payload: payload||{}, tags:Array.isArray(tags)?tags:[], seal_level: level }, meta });
    await appendEvent({ client, stream:`capsule:${capsule_id}`, type:"capsule.created", actor, capsule_id, payload:{ title, payload: payload||{}, tags:Array.isArray(tags)?tags:[], seal_level: level }, meta });
    await client.query("COMMIT");

    await queue.add("project_event", { event_id: eG.id }, { removeOnComplete: true, attempts: 5 });
    res.status(201).json({ ok:true, capsule_id, event_id: eG.id, hash: eG.hash });
  } catch {
    await client.query("ROLLBACK");
    res.status(500).json({ ok:false, error:"append_failed" });
  } finally {
    client.release();
  }
});

app.post("/capsules/:id/seal", async (req, res) => {
  const actor = actorFrom(req);
  if (!actor) return res.status(400).json({ ok:false, error:"missing x-actor" });

  const capsule_id = req.params.id;
  const pr = await pool.query("SELECT status FROM pr_capsules WHERE id=$1", [capsule_id]);
  if (!pr.rows.length) return res.status(404).json({ ok:false, error:"capsule_not_found_or_not_projected_yet" });
  if (pr.rows[0].status === "sealed") return res.status(409).json({ ok:false, error:"already_sealed" });

  const reason = (req.body?.reason || "").toString().slice(0, 500);
  const meta = { rationale:"Seal is power -> immutable event.", unknowns:["Quorum/multisig policies could be added later."] };

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const eG = await appendEvent({ client, stream:"global", type:"capsule.sealed", actor, capsule_id, payload:{ reason }, meta });
    await appendEvent({ client, stream:`capsule:${capsule_id}`, type:"capsule.sealed", actor, capsule_id, payload:{ reason }, meta });
    await client.query("COMMIT");

    await queue.add("project_event", { event_id: eG.id }, { removeOnComplete: true, attempts: 5 });
    res.json({ ok:true, capsule_id, event_id: eG.id, hash: eG.hash });
  } catch {
    await client.query("ROLLBACK");
    res.status(500).json({ ok:false, error:"append_failed" });
  } finally {
    client.release();
  }
});

app.get("/capsules", async (req, res) => {
  const q = (req.query.q || "").toString().trim();
  const status = (req.query.status || "").toString().trim();
  const limit = Math.min(200, Math.max(1, Number(req.query.limit || 50)));

  const where = [];
  const params = [];
  let i = 1;
  if (q) { where.push(`title ILIKE $${i}`); params.push(`%${q}%`); i++; }
  if (status === "open" || status === "sealed") { where.push(`status=$${i}`); params.push(status); i++; }

  params.push(limit);
  const sql = `SELECT id,title,tags,seal_level,status,created_at,sealed_at,last_event_id
               FROM pr_capsules ${where.length ? "WHERE "+where.join(" AND ") : ""}
               ORDER BY created_at DESC LIMIT $${i}`;
  const { rows } = await pool.query(sql, params);
  res.json({ ok:true, items: rows });
});

app.get("/capsules/:id", async (req, res) => {
  const id = req.params.id;
  const c = await pool.query("SELECT * FROM pr_capsules WHERE id=$1", [id]);
  if (!c.rows.length) return res.status(404).json({ ok:false, error:"not_found" });

  const ev = await pool.query(
    "SELECT id,ts,stream_seq,type,actor,payload,meta,prev_hash,hash FROM es_events WHERE stream=$1 ORDER BY stream_seq ASC",
    [`capsule:${id}`]
  );
  const comments = await pool.query(
    "SELECT id,ts,actor,body FROM so_comments WHERE capsule_id=$1 ORDER BY ts DESC LIMIT 200",
    [id]
  );
  res.json({ ok:true, capsule: c.rows[0], events: ev.rows, social: { comments: comments.rows } });
});

app.get("/audit/events", async (req, res) => {
  const capsule_id = (req.query.capsule_id || "").toString().trim();
  const actor = (req.query.actor || "").toString().trim();
  const type = (req.query.type || "").toString().trim();
  const limit = Math.min(500, Math.max(1, Number(req.query.limit || 100)));

  const where = [];
  const params = [];
  let i = 1;
  if (capsule_id) { where.push(`capsule_id::text=$${i}`); params.push(capsule_id); i++; }
  if (actor) { where.push(`actor=$${i}`); params.push(actor); i++; }
  if (type) { where.push(`type=$${i}`); params.push(type); i++; }

  params.push(limit);
  const sql = `SELECT id,ts,stream,stream_seq,type,actor,capsule_id,prev_hash,hash
               FROM es_events ${where.length ? "WHERE "+where.join(" AND ") : ""}
               ORDER BY id DESC LIMIT $${i}`;
  const { rows } = await pool.query(sql, params);
  res.json({ ok:true, items: rows });
});

async function verifyStream(stream) {
  const { rows } = await pool.query(
    "SELECT stream,stream_seq,type,actor,capsule_id,payload,meta,prev_hash,hash,id FROM es_events WHERE stream=$1 ORDER BY stream_seq ASC",
    [stream]
  );
  let prev = "GENESIS";
  for (const r of rows) {
    const body = { stream:r.stream, stream_seq:Number(r.stream_seq), type:r.type, actor:r.actor, capsule_id:r.capsule_id, payload:r.payload, meta:r.meta, prev_hash:r.prev_hash };
    const expect = sha256(`${prev}|${stableStringify(body)}|${salt}`);
    if (r.prev_hash !== prev) return { ok:false, stream, bad_event_id:r.id, reason:"prev_hash_mismatch" };
    if (r.hash !== expect) return { ok:false, stream, bad_event_id:r.id, reason:"hash_mismatch" };
    prev = r.hash;
  }
  return { ok:true, stream, count: rows.length };
}

app.get("/audit/verify", async (req, res) => {
  const r = await verifyStream("global");
  res.status(r.ok ? 200 : 409).json(r);
});
app.get("/audit/verify/:id", async (req, res) => {
  const r = await verifyStream(`capsule:${req.params.id}`);
  res.status(r.ok ? 200 : 409).json(r);
});

app.post("/social/comments", async (req, res) => {
  const actor = (actorFrom(req) || "anonymous").slice(0, 64);
  const { capsule_id, body } = req.body || {};
  if (!capsule_id) return res.status(400).json({ ok:false, error:"capsule_id required" });
  if (!body || typeof body !== "string") return res.status(400).json({ ok:false, error:"body required" });
  await pool.query("INSERT INTO so_comments(capsule_id,actor,body) VALUES($1,$2,$3)", [capsule_id, actor, body.slice(0,2000)]);
  res.status(201).json({ ok:true });
});

app.use((req, res) => res.status(404).json({ ok:false, error:"not_found", path:req.path }));

app.listen(3000, () => console.log("[chronovault-api] up :3000", version));
