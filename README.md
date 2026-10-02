# Rate Limiter Learning Project

A tiny Node.js + Express project to understand **four rate-limiting algorithms**.
Everything is stored in memory. No database, no Redis, no auth, no frontend.

## Run it

```bash
npm install
npm start
```

Server starts at `http://localhost:3000`.

## Endpoints

```text
GET /                              -> small project description
GET /api/fixed?user=aakash         -> Fixed Window
GET /api/sliding?user=aakash       -> Sliding Window
GET /api/leaky?user=aakash         -> Leaky Bucket
GET /api/token?user=aakash         -> Token Bucket
```

If `?user=` is missing, the user is `"default"`.

## Configuration

| Algorithm      | Limit                                         |
| -------------- | --------------------------------------------- |
| Fixed Window   | 5 requests / 10 seconds                       |
| Sliding Window | 5 requests / 10 seconds                       |
| Leaky Bucket   | capacity 5, leaks 1 request every 2 seconds   |
| Token Bucket   | max 5 tokens, refills 1 token every 2 seconds |

## Response format

```json
{
  "allowed": true,
  "algorithm": "Token Bucket",
  "remaining": 3
}
```

- Leaky Bucket also returns `queueSize`.
- Token Bucket also returns `tokens`.

## Demonstration

### Fixed Window (5 requests / 10 seconds)

```bash
for i in $(seq 1 6); do curl "http://localhost:3000/api/fixed?user=aakash"; echo; done
# first 5 allowed, 6th rejected

sleep 10 && curl "http://localhost:3000/api/fixed?user=aakash"
# allowed again (new window started)
```

PowerShell:

```powershell
1..6 | ForEach-Object { Invoke-RestMethod "http://localhost:3000/api/fixed?user=aakash" }
# first 5 allowed, 6th rejected

Start-Sleep -Seconds 10; Invoke-RestMethod "http://localhost:3000/api/fixed?user=aakash"
# allowed again (new window started)
```

### Sliding Window (5 requests / 10 seconds)

```bash
for i in $(seq 1 6); do curl "http://localhost:3000/api/sliding?user=aakash"; echo; done
# first 5 allowed, 6th rejected

sleep 10 && curl "http://localhost:3000/api/sliding?user=aakash"
# allowed again
```

PowerShell:

```powershell
1..6 | ForEach-Object { Invoke-RestMethod "http://localhost:3000/api/sliding?user=aakash" }
# first 5 allowed, 6th rejected

Start-Sleep -Seconds 10; Invoke-RestMethod "http://localhost:3000/api/sliding?user=aakash"
# allowed again
```

### Leaky Bucket (capacity 5, leaks 1 every 2 seconds)

```bash
for i in $(seq 1 6); do curl "http://localhost:3000/api/leaky?user=aakash"; echo; done
# first 5 enter the queue, 6th rejected (queue full)

sleep 4 && curl "http://localhost:3000/api/leaky?user=aakash"
# allowed: 2 requests leaked out in 4 seconds, so there is room
```

PowerShell:

```powershell
1..6 | ForEach-Object { Invoke-RestMethod "http://localhost:3000/api/leaky?user=aakash" }
# first 5 enter the queue, 6th rejected (queue full)

Start-Sleep -Seconds 4; Invoke-RestMethod "http://localhost:3000/api/leaky?user=aakash"
# allowed: 2 requests leaked out in 4 seconds, so there is room
```

### Token Bucket (5 tokens, refill 1 every 2 seconds)

```bash
for i in $(seq 1 6); do curl "http://localhost:3000/api/token?user=aakash"; echo; done
# first 5 allowed (tokens spent), 6th rejected (0 tokens)

sleep 4 && curl "http://localhost:3000/api/token?user=aakash"
# allowed: 2 tokens refilled, you can burst 2 requests in a row
```

PowerShell:

```powershell
1..6 | ForEach-Object { Invoke-RestMethod "http://localhost:3000/api/token?user=aakash" }
# first 5 allowed (tokens spent), 6th rejected (0 tokens)

Start-Sleep -Seconds 4; Invoke-RestMethod "http://localhost:3000/api/token?user=aakash"
# allowed: 2 tokens refilled, you can burst 2 requests in a row
```

Each algorithm keeps its own map, so users are independent per algorithm.
Use different `?user=` values to test multiple users.

## Key differences

**Fixed Window**
- Simple counter per fixed time slice.
- Cheap and easy, but allows a burst of 2x the limit across a window
  boundary (e.g. 5 at the end + 5 at the start).

**Sliding Window**
- Stores actual request timestamps and drops old ones.
- No boundary burst problem, more accurate, but uses more memory
  (an array of timestamps per user).

**Leaky Bucket**
- Queue that drains at a constant rate, no matter how many requests
  arrive. Smooths traffic into an even output.
- Requests wait in line; if the queue is full, they are dropped.
- Output rate is always 1 request / 2 seconds here.

**Token Bucket**
- Tokens refill at a constant rate, but requests can spend accumulated
  tokens all at once, so bursts are allowed.
- Output rate is not smooth: idle time builds up a reserve that can be
  consumed quickly.

**Leaky Bucket vs Token Bucket**
- Leaky Bucket = strict, smooth output (no bursts).
- Token Bucket = smooth refill, but bursts are allowed.
