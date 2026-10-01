const express = require("express");
const cors = require("cors");
const crypto = require("crypto");

const app = express();

app.use(cors());
app.use(express.json());

/*
  ============================================================
  AUTOForge Sentinel
  Serverless demo backend
  No external database required
  ============================================================

  IMPORTANT:
  This uses memory storage.
  Data may reset when the Vercel function restarts.
*/

// ------------------------------------------------------------
// In-memory storage
// ------------------------------------------------------------

const sensors = new Map();
const events = [];
const maintenance = [];
const batches = [];

// ------------------------------------------------------------
// Demo sensor data
// ------------------------------------------------------------

const demoSensors = [
  {
    machineId: "MACHINE-001",
    sensorId: "TEMP-001",
    temperature: 72.4,
    vibration: 2.1,
    pressure: 101.2,
    status: "normal",
    updatedAt: new Date().toISOString()
  },
  {
    machineId: "MACHINE-002",
    sensorId: "TEMP-002",
    temperature: 84.7,
    vibration: 4.8,
    pressure: 108.6,
    status: "warning",
    updatedAt: new Date().toISOString()
  },
  {
    machineId: "MACHINE-003",
    sensorId: "TEMP-003",
    temperature: 96.3,
    vibration: 7.4,
    pressure: 115.1,
    status: "critical",
    updatedAt: new Date().toISOString()
  }
];

for (const sensor of demoSensors) {
  sensors.set(sensor.machineId, sensor);
}

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------

function id() {
  return crypto.randomUUID();
}

function now() {
  return new Date().toISOString();
}

function classifySensor(data) {
  const temperature = Number(data.temperature || 0);
  const vibration = Number(data.vibration || 0);
  const pressure = Number(data.pressure || 0);

  if (
    temperature >= 95 ||
    vibration >= 7 ||
    pressure >= 120
  ) {
    return "critical";
  }

  if (
    temperature >= 80 ||
    vibration >= 4 ||
    pressure >= 110
  ) {
    return "warning";
  }

  return "normal";
}

// ------------------------------------------------------------
// Root
// ------------------------------------------------------------

app.get("/", (req, res) => {
  res.json({
    ok: true,
    service: "AutoForge Sentinel Backend",
    version: "1.0.0",
    status: "running",
    database: "in-memory",
    endpoints: {
      health: "/health",
      dashboard: "/api/dashboard",
      sensors: "/api/sensors",
      events: "/api/events",
      maintenance: "/api/maintenance",
      batches: "/api/batches"
    }
  });
});

// ------------------------------------------------------------
// Health
// ------------------------------------------------------------

app.get("/health", (req, res) => {
  res.json({
    ok: true,
    database: "in-memory",
    message: "AutoForge Sentinel API is running"
  });
});

// ------------------------------------------------------------
// Dashboard
// ------------------------------------------------------------

app.get("/api/dashboard", (req, res) => {
  const sensorList = Array.from(sensors.values());

  const normal = sensorList.filter(
    (s) => s.status === "normal"
  ).length;

  const warning = sensorList.filter(
    (s) => s.status === "warning"
  ).length;

  const critical = sensorList.filter(
    (s) => s.status === "critical"
  ).length;

  res.json({
    ok: true,

    summary: {
      totalMachines: sensorList.length,
      normal,
      warning,
      critical,
      totalEvents: events.length,
      totalMaintenance: maintenance.length,
      totalBatches: batches.length
    },

    sensors: sensorList,

    recentEvents: events.slice(-10).reverse(),

    recentMaintenance: maintenance
      .slice(-10)
      .reverse(),

    recentBatches: batches
      .slice(-10)
      .reverse()
  });
});

// ------------------------------------------------------------
// Sensors
// ------------------------------------------------------------

app.get("/api/sensors", (req, res) => {
  res.json({
    ok: true,
    sensors: Array.from(sensors.values())
  });
});

// Receive sensor packet
app.post("/api/sensors/packet", (req, res) => {
  const body = req.body || {};

  const machineId =
    body.machineId ||
    body.machine_id ||
    "UNKNOWN-MACHINE";

  const sensorId =
    body.sensorId ||
    body.sensor_id ||
    `SENSOR-${machineId}`;

  const sensor = {
    machineId,
    sensorId,

    temperature:
      body.temperature !== undefined
        ? Number(body.temperature)
        : null,

    vibration:
      body.vibration !== undefined
        ? Number(body.vibration)
        : null,

    pressure:
      body.pressure !== undefined
        ? Number(body.pressure)
        : null,

    status: classifySensor(body),

    updatedAt: now()
  };

  sensors.set(machineId, sensor);

  // Automatically create an event for warning/critical readings
  if (
    sensor.status === "warning" ||
    sensor.status === "critical"
  ) {
    events.push({
      id: id(),
      machineId,
      type:
        sensor.status === "critical"
          ? "critical_sensor"
          : "sensor_warning",
      severity: sensor.status,
      message:
        sensor.status === "critical"
          ? "Critical sensor condition detected"
          : "Sensor warning detected",
      createdAt: now()
    });
  }

  res.status(201).json({
    ok: true,
    sensor
  });
});

// Get packets / sensor history
app.get("/api/sensors/packets", (req, res) => {
  res.json({
    ok: true,
    packets: Array.from(sensors.values())
  });
});

// Latest sensor for machine
app.get("/api/sensors/latest/:machineId", (req, res) => {
  const machineId = req.params.machineId;

  const sensor = sensors.get(machineId);

  if (!sensor) {
    return res.status(404).json({
      ok: false,
      error: "Machine not found",
      machineId
    });
  }

  res.json({
    ok: true,
    sensor
  });
});

// ------------------------------------------------------------
// Events
// ------------------------------------------------------------

app.get("/api/events", (req, res) => {
  res.json({
    ok: true,
    events: [...events].reverse()
  });
});

app.post("/api/events", (req, res) => {
  const body = req.body || {};

  const event = {
    id: id(),
    machineId: body.machineId || null,
    type: body.type || "general",
    severity: body.severity || "info",
    message: body.message || "Event created",
    metadata: body.metadata || null,
    createdAt: now()
  };

  events.push(event);

  res.status(201).json({
    ok: true,
    event
  });
});

// ------------------------------------------------------------
// Maintenance
// ------------------------------------------------------------

app.get("/api/maintenance", (req, res) => {
  res.json({
    ok: true,
    maintenance: [...maintenance].reverse()
  });
});

app.post("/api/maintenance", (req, res) => {
  const body = req.body || {};

  const record = {
    id: id(),
    machineId: body.machineId || null,
    title: body.title || "Maintenance task",
    description: body.description || "",
    status: body.status || "scheduled",
    scheduledAt: body.scheduledAt || null,
    technician: body.technician || null,
    createdAt: now()
  };

  maintenance.push(record);

  res.status(201).json({
    ok: true,
    maintenance: record
  });
});

app.patch("/api/maintenance/:id", (req, res) => {
  const index = maintenance.findIndex(
    (item) => item.id === req.params.id
  );

  if (index === -1) {
    return res.status(404).json({
      ok: false,
      error: "Maintenance record not found"
    });
  }

  maintenance[index] = {
    ...maintenance[index],
    ...req.body,
    id: maintenance[index].id,
    updatedAt: now()
  };

  res.json({
    ok: true,
    maintenance: maintenance[index]
  });
});

// ------------------------------------------------------------
// Batches
// ------------------------------------------------------------

app.get("/api/batches", (req, res) => {
  res.json({
    ok: true,
    batches: [...batches].reverse()
  });
});

app.post("/api/batches", (req, res) => {
  const body = req.body || {};

  const batch = {
    id: id(),
    batchNumber:
      body.batchNumber ||
      `BATCH-${Date.now()}`,
    machineId: body.machineId || null,
    product: body.product || null,
    quantity:
      body.quantity !== undefined
        ? Number(body.quantity)
        : 0,
    status: body.status || "processing",
    createdAt: now()
  };

  batches.push(batch);

  res.status(201).json({
    ok: true,
    batch
  });
});

// ------------------------------------------------------------
// 404 handler
// ------------------------------------------------------------

app.use((req, res) => {
  res.status(404).json({
    error: "Route not found",
    path: req.path
  });
});

// ------------------------------------------------------------
// Export for Vercel
// ------------------------------------------------------------

module.exports = app;
