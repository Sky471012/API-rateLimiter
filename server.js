const express = require("express");

const app = express();
const PORT = 3000;

// Shared config for Fixed Window + Sliding Window
const LIMIT = 5;
const WINDOW_MS = 10 * 1000; // 10 seconds

// Leaky Bucket config
const BUCKET_CAPACITY = 5;
const LEAK_INTERVAL_MS = 2 * 1000; // leaks 1 request every 2 seconds

// Token Bucket config
const MAX_TOKENS = 5;
const TOKEN_REFILL_MS = 2 * 1000; // refills 1 token every 2 seconds

// All state lives in plain objects in memory.
const fixedWindows = {}; // { [user]: { count, windowStart } }
const slidingWindows = {}; // { [user]: [timestamp, ...] }
const leakyBuckets = {}; // { [user]: { queue: [], lastLeakTime } }
const tokenBuckets = {}; // { [user]: { tokens, lastRefillTime } }

function getUser(req) {
  return req.query.user || "default";
}

// 1) FIXED WINDOW: one counter per window. When the 10s window expires,
// reset the counter and start a new window.
app.get("/api/fixed", (req, res) => {
  const user = getUser(req);
  const now = Date.now();

  let entry = fixedWindows[user];

  // Start a new window if there is none, or the old window expired.
  if (!entry || now - entry.windowStart >= WINDOW_MS) {
    entry = { count: 0, windowStart: now };
    fixedWindows[user] = entry;
  }

  if (entry.count >= LIMIT) {
    return res.json({ allowed: false, algorithm: "Fixed Window", remaining: 0 });
  }

  entry.count++;
  res.json({
    allowed: true,
    algorithm: "Fixed Window",
    remaining: LIMIT - entry.count,
  });
});

// 2) SLIDING WINDOW: keep every request timestamp. On each request, drop
// timestamps older than 10 seconds, then check how many are left.
app.get("/api/sliding", (req, res) => {
  const user = getUser(req);
  const now = Date.now();

  if (!slidingWindows[user]) slidingWindows[user] = [];

  // Remove timestamps older than 10 seconds.
  slidingWindows[user] = slidingWindows[user].filter(
    (ts) => now - ts < WINDOW_MS
  );

  if (slidingWindows[user].length >= LIMIT) {
    return res.json({
      allowed: false,
      algorithm: "Sliding Window",
      remaining: 0,
    });
  }

  slidingWindows[user].push(now);
  res.json({
    allowed: true,
    algorithm: "Sliding Window",
    remaining: LIMIT - slidingWindows[user].length,
  });
});

// Remove `leaked` items from the front of the queue and move the leak
// clock forward, keeping any leftover time toward the next leak.
function drainLeakyBucket(bucket) {
  const now = Date.now();
  const leaked = Math.floor((now - bucket.lastLeakTime) / LEAK_INTERVAL_MS);

  if (leaked > 0) {
    bucket.queue.splice(0, Math.min(leaked, bucket.queue.length));
    bucket.lastLeakTime += leaked * LEAK_INTERVAL_MS;
  }
}

// 3) LEAKY BUCKET: requests queue up and leak out 1 every 2 seconds.
// Full queue (5) -> reject the new request. The queue drains even if no
// new requests arrive (see the setInterval below).
app.get("/api/leaky", (req, res) => {
  const user = getUser(req);

  if (!leakyBuckets[user]) {
    leakyBuckets[user] = { queue: [], lastLeakTime: Date.now() };
  }
  const bucket = leakyBuckets[user];

  drainLeakyBucket(bucket); // drain first, so waiting frees up space

  if (bucket.queue.length >= BUCKET_CAPACITY) {
    return res.json({
      allowed: false,
      algorithm: "Leaky Bucket",
      remaining: 0,
      queueSize: bucket.queue.length,
    });
  }

  bucket.queue.push(Date.now());
  res.json({
    allowed: true,
    algorithm: "Leaky Bucket",
    remaining: BUCKET_CAPACITY - bucket.queue.length,
    queueSize: bucket.queue.length,
  });
});

// Keep draining every 200ms so requests leave the bucket even when idle.
setInterval(() => {
  Object.values(leakyBuckets).forEach(drainLeakyBucket);
}, 200);

// Add back the tokens earned since the last refill, up to MAX_TOKENS.
function refillTokens(bucket) {
  const gained = Math.floor(
    (Date.now() - bucket.lastRefillTime) / TOKEN_REFILL_MS
  );

  if (gained > 0) {
    bucket.tokens = Math.min(MAX_TOKENS, bucket.tokens + gained);
    bucket.lastRefillTime += gained * TOKEN_REFILL_MS;
  }
}

// 4) TOKEN BUCKET: start with 5 tokens, refill 1 every 2 seconds.
// Each request costs 1 token; accumulated tokens allow bursts.
app.get("/api/token", (req, res) => {
  const user = getUser(req);

  if (!tokenBuckets[user]) {
    tokenBuckets[user] = { tokens: MAX_TOKENS, lastRefillTime: Date.now() };
  }
  const bucket = tokenBuckets[user];

  refillTokens(bucket);

  if (bucket.tokens <= 0) {
    return res.json({
      allowed: false,
      algorithm: "Token Bucket",
      remaining: 0,
      tokens: bucket.tokens,
    });
  }

  bucket.tokens--;
  res.json({
    allowed: true,
    algorithm: "Token Bucket",
    remaining: bucket.tokens,
    tokens: bucket.tokens,
  });
});

app.get("/", (req, res) => {
  res.json({
    message:
      "Rate limiting learning project. Try: /api/fixed, /api/sliding, /api/leaky, /api/token with ?user=aakash",
    limits: {
      fixedWindow: "5 requests / 10 seconds",
      slidingWindow: "5 requests / 10 seconds",
      leakyBucket: "capacity 5, leaks 1 request every 2 seconds",
      tokenBucket: "max 5 tokens, refills 1 token every 2 seconds",
    },
  });
});

app.listen(PORT, () => {
  console.log(`Rate limiter learning server running on http://localhost:${PORT}`);
});
