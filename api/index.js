const express = require("express");
const cors = require("cors");
const { neon } = require("@neondatabase/serverless");

const app = express();
app.use(cors({ origin: process.env.ALLOWED_ORIGIN || "*" }));
app.use(express.json());

function sqlClient() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL environment variable is not configured");
  return neon(process.env.DATABASE_URL);
}

async function initDb(sql) {
  await sql`CREATE TABLE IF NOT EXISTS sensor_packets (
    id BIGSERIAL PRIMARY KEY, machine_id TEXT NOT NULL, timestamp TIMESTAMPTZ NOT NULL,
    rpm DOUBLE PRECISION NOT NULL, vibration DOUBLE PRECISION NOT NULL,
    temperature DOUBLE PRECISION NOT NULL, current DOUBLE PRECISION NOT NULL,
    status TEXT NOT NULL, risk DOUBLE PRECISION NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
  await sql`CREATE TABLE IF NOT EXISTS events (
    id BIGSERIAL PRIMARY KEY, machine_id TEXT NOT NULL, type TEXT NOT NULL,
    severity TEXT NOT NULL, message TEXT NOT NULL, timestamp TIMESTAMPTZ NOT NULL)`;
  await sql`CREATE TABLE IF NOT EXISTS maintenance (
    id BIGSERIAL PRIMARY KEY, machine_id TEXT NOT NULL, action TEXT NOT NULL,
    priority TEXT NOT NULL, status TEXT NOT NULL, due_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`;
  await sql`CREATE TABLE IF NOT EXISTS batches (
    id BIGSERIAL PRIMARY KEY, batch_id TEXT UNIQUE NOT NULL, machine_id TEXT NOT NULL,
    quantity INTEGER NOT NULL, good INTEGER NOT NULL DEFAULT 0, reject INTEGER NOT NULL DEFAULT 0,
    started_at TIMESTAMPTZ NOT NULL, completed_at TIMESTAMPTZ)`;
}

function classifySensor({rpm, vibration, temperature, current}) {
  let score = 0;
  if (vibration > 7) score += 2; else if (vibration > 4) score += 1;
  if (temperature > 85) score += 2; else if (temperature > 70) score += 1;
  if (current > 18) score += 2; else if (current > 14) score += 1;
  if (rpm < 900 || rpm > 1800) score += 1;
  const status = score >= 4 ? "Reject" : score >= 2 ? "Warning" : "Good";
  const risk = Math.min(99, Math.round(score * 18 + vibration * 3 + Math.max(0, temperature - 60) * 0.5));
  return {status, risk};
}

app.get("/health", async (req,res) => {
  try { const sql=sqlClient(); await sql`SELECT 1`;
    res.json({ok:true,database:"connected",service:"autoforge-sentinel-backend",time:new Date().toISOString()});
  } catch(e) { res.status(503).json({ok:false,database:"unavailable",error:e.message}); }
});

app.get("/api/dashboard", async (req,res) => {
  try {
    const sql=sqlClient(); await initDb(sql);
    const latest=await sql`SELECT * FROM sensor_packets ORDER BY id DESC LIMIT 1`;
    const statusCounts=await sql`SELECT status, COUNT(*)::int AS count FROM sensor_packets GROUP BY status ORDER BY status`;
    const maintenance=await sql`SELECT COUNT(*)::int AS count FROM maintenance WHERE status IN ('Open','In Progress')`;
    const totals=await sql`SELECT (SELECT COUNT(*)::int FROM sensor_packets) AS packets,
      (SELECT COUNT(*)::int FROM events) AS events, (SELECT COUNT(*)::int FROM batches) AS batches`;
    res.json({latest:latest[0]||null,statusCounts,maintenance:{open:maintenance[0].count},totals:totals[0]});
  } catch(e){res.status(500).json({error:e.message});}
});

app.post("/api/sensors/packet", async (req,res) => {
  try {
    const {machineId="M-001",rpm,vibration,temperature,current}=req.body;
    if([rpm,vibration,temperature,current].some(v=>typeof v!=="number"||!Number.isFinite(v)))
      return res.status(400).json({error:"rpm, vibration, temperature and current must be numbers"});
    const sql=sqlClient(); await initDb(sql);
    const {status,risk}=classifySensor({rpm,vibration,temperature,current});
    const timestamp=new Date().toISOString();
    const rows=await sql`INSERT INTO sensor_packets
      (machine_id,timestamp,rpm,vibration,temperature,current,status,risk)
      VALUES (${machineId},${timestamp},${rpm},${vibration},${temperature},${current},${status},${risk}) RETURNING *`;
    if(status!=="Good") await sql`INSERT INTO events
      (machine_id,type,severity,message,timestamp)
      VALUES (${machineId},'sensor_alert',${status},${"Sensor fusion classified packet as "+status},${timestamp})`;
    res.status(201).json(rows[0]);
  } catch(e){res.status(500).json({error:e.message});}
});

app.get("/api/sensors/packets", async (req,res) => {
  try { const sql=sqlClient(); await initDb(sql);
    const limit=Math.min(Math.max(Number(req.query.limit||100),1),1000);
    res.json(await sql`SELECT * FROM sensor_packets ORDER BY id DESC LIMIT ${limit}`);
  } catch(e){res.status(500).json({error:e.message});}
});

app.get("/api/sensors/latest/:machineId", async (req,res) => {
  try { const sql=sqlClient(); await initDb(sql);
    const rows=await sql`SELECT * FROM sensor_packets WHERE machine_id=${req.params.machineId} ORDER BY id DESC LIMIT 1`;
    if(!rows[0]) return res.status(404).json({error:"No sensor data found"});
    res.json(rows[0]);
  } catch(e){res.status(500).json({error:e.message});}
});

app.get("/api/events", async (req,res) => {
  try { const sql=sqlClient(); await initDb(sql);
    const limit=Math.min(Math.max(Number(req.query.limit||100),1),1000);
    res.json(await sql`SELECT * FROM events ORDER BY id DESC LIMIT ${limit}`);
  } catch(e){res.status(500).json({error:e.message});}
});

app.post("/api/events", async (req,res) => {
  try { const {machineId="M-001",type="manual",severity="Info",message}=req.body;
    if(!message) return res.status(400).json({error:"message is required"});
    const sql=sqlClient(); await initDb(sql); const timestamp=new Date().toISOString();
    const rows=await sql`INSERT INTO events (machine_id,type,severity,message,timestamp)
      VALUES (${machineId},${type},${severity},${message},${timestamp}) RETURNING *`;
    res.status(201).json(rows[0]);
  } catch(e){res.status(500).json({error:e.message});}
});

app.get("/api/maintenance", async (req,res) => {
  try { const sql=sqlClient(); await initDb(sql); res.json(await sql`SELECT * FROM maintenance ORDER BY id DESC`); }
  catch(e){res.status(500).json({error:e.message});}
});

app.post("/api/maintenance", async (req,res) => {
  try { const {machineId="M-001",action,priority="Medium",dueAt=null}=req.body;
    if(!action) return res.status(400).json({error:"action is required"});
    const sql=sqlClient(); await initDb(sql);
    const rows=await sql`INSERT INTO maintenance (machine_id,action,priority,status,due_at)
      VALUES (${machineId},${action},${priority},'Open',${dueAt}) RETURNING *`;
    res.status(201).json(rows[0]);
  } catch(e){res.status(500).json({error:e.message});}
});

app.patch("/api/maintenance/:id", async (req,res) => {
  try { const allowed=["Open","In Progress","Completed","Cancelled"],{status}=req.body;
    if(!allowed.includes(status)) return res.status(400).json({error:"Invalid maintenance status"});
    const sql=sqlClient(); await initDb(sql);
    const rows=await sql`UPDATE maintenance SET status=${status} WHERE id=${req.params.id} RETURNING *`;
    if(!rows[0]) return res.status(404).json({error:"Maintenance record not found"});
    res.json(rows[0]);
  } catch(e){res.status(500).json({error:e.message});}
});

app.get("/api/batches", async (req,res) => {
  try { const sql=sqlClient(); await initDb(sql); res.json(await sql`SELECT * FROM batches ORDER BY id DESC`); }
  catch(e){res.status(500).json({error:e.message});}
});

app.post("/api/batches", async (req,res) => {
  try { const {batchId,machineId="M-001",quantity,good=0,reject=0}=req.body;
    if(!batchId||!Number.isInteger(quantity)) return res.status(400).json({error:"batchId and integer quantity are required"});
    const sql=sqlClient(); await initDb(sql);
    const rows=await sql`INSERT INTO batches (batch_id,machine_id,quantity,good,reject,started_at)
      VALUES (${batchId},${machineId},${quantity},${good},${reject},NOW()) RETURNING *`;
    res.status(201).json(rows[0]);
  } catch(e){ if(e.code==="23505") return res.status(409).json({error:"batchId already exists"});
    res.status(500).json({error:e.message});}
});

app.use((req,res)=>res.status(404).json({error:"Route not found",path:req.originalUrl}));
module.exports=app;
