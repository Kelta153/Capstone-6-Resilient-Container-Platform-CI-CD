const express = require("express");
const { createClient } = require("redis");
const { Client } = require("pg");
const { SQSClient, SendMessageCommand } = require("@aws-sdk/client-sqs");

const app = express();
app.use(express.json());

const PORT = process.env.PORT || 3000;

const redis = createClient({
  url: process.env.REDIS_URL,
});

const pg = new Client({
  host: process.env.DB_HOST,
  port: 5432,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: { rejectUnauthorized: false },
});

const sqs = new SQSClient({
  region: process.env.AWS_REGION,
});

app.get("/", (req, res) => {
  res.json({
    service: "resilient-platform-web",
    status: "healthy",
  });
});

app.get("/health", (req, res) => {
  res.json({ status: "healthy" });
});

app.get("/data", async (req, res) => {
  try {
    const cached = await redis.get("platform-data");

    if (cached) {
      return res.json({
        source: "redis",
        data: JSON.parse(cached),
      });
    }

    const result = await pg.query("SELECT NOW() AS timestamp");

    const data = {
      timestamp: result.rows[0].timestamp,
    };

    await redis.setEx("platform-data", 60, JSON.stringify(data));

    res.json({
      source: "postgres",
      data,
    });
  } catch (err) {
    console.error("Data request failed:", err);
    res.status(500).json({ error: "Database or Redis unavailable" });
  }
});

app.post("/orders", async (req, res) => {
  try {
    await sqs.send(
      new SendMessageCommand({
        QueueUrl: process.env.SQS_QUEUE_URL,
        MessageBody: JSON.stringify(req.body),
      }),
    );

    res.status(202).json({
      message: "Order queued",
    });
  } catch (err) {
    console.error("Order request failed:", err);
    res.status(500).json({ error: "Unable to queue order" });
  }
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`Web server running on port ${PORT}`);
});

async function connectDependencies() {
  try {
    await redis.connect();
    console.log("Redis connected");
  } catch (err) {
    console.error("Redis connection failed:", err.message);
  }

  try {
    await pg.connect();
    console.log("PostgreSQL connected");
  } catch (err) {
    console.error("PostgreSQL connection failed:", err.message);
  }
}

connectDependencies();
