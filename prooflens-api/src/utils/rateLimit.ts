// prooflens-api/src/utils/rateLimit.ts
// Sliding-window in-memory rate limiter with per-IP and per-user tiers.
// Drop-in replacement – still exports `rateLimitShare` for existing call-sites
// and adds a configurable `rateLimit()` factory for all other routes.
import { Request, Response, NextFunction } from "express";

interface Window {
  timestamps: number[];
}

const buckets = new Map<string, Window>();

// Periodic cleanup every 5 minutes to prevent unbounded memory growth
const CLEANUP_INTERVAL_MS = 5 * 60 * 1000;
setInterval(() => {
  const cutoff = Date.now();
  for (const [key, win] of buckets) {
    // Remove windows that haven't been touched recently
    if (win.timestamps.length === 0 || win.timestamps[win.timestamps.length - 1] < cutoff - 120_000) {
      buckets.delete(key);
    }
  }
}, CLEANUP_INTERVAL_MS).unref();

/**
 * Client IP for rate-limit purposes.
 *
 * `x-forwarded-for` is attacker-controlled unless a trusted proxy is in front,
 * so it is NOT read directly. Express derives `req.ip` from the header only
 * when `trust proxy` is configured (see server.ts), which bounds how much of
 * the chain is believed. Without that setting the socket address is used.
 */
function extractIp(req: Request): string {
  return req.ip || req.socket?.remoteAddress || "unknown";
}

function slidingWindowCheck(key: string, windowMs: number, max: number): boolean {
  const now = Date.now();
  let win = buckets.get(key);
  if (!win) {
    win = { timestamps: [] };
    buckets.set(key, win);
  }

  // Trim expired timestamps
  const cutoff = now - windowMs;
  while (win.timestamps.length > 0 && win.timestamps[0] < cutoff) {
    win.timestamps.shift();
  }

  if (win.timestamps.length >= max) {
    return false; // rate-limited
  }

  win.timestamps.push(now);
  return true; // allowed
}

export interface RateLimitOptions {
  windowMs?: number;    // sliding window size in ms (default 60s)
  maxPerIp?: number;    // max requests per IP per window
  maxPerUser?: number;  // max requests per authenticated user per window (0 = no per-user)
  keyPrefix?: string;   // namespace prefix to isolate counters
}

/**
 * Factory – returns Express middleware with configurable rate limits.
 *
 *   app.use("/credentials", rateLimit({ maxPerIp: 20, maxPerUser: 40 }));
 */
export function rateLimit(opts: RateLimitOptions = {}) {
  const {
    windowMs = 60_000,
    maxPerIp = 30,
    maxPerUser = 0,
    keyPrefix = "rl",
  } = opts;

  return (req: Request, res: Response, next: NextFunction) => {
    const ip = extractIp(req);
    const ipKey = `${keyPrefix}:ip:${ip}`;

    if (!slidingWindowCheck(ipKey, windowMs, maxPerIp)) {
      res.setHeader("Retry-After", String(Math.ceil(windowMs / 1000)));
      return res.status(429).json({ error: "rate_limit_exceeded" });
    }

    // Per-user check (userId may be set by auth middleware or extracted lazily)
    if (maxPerUser > 0) {
      // Identity must come from a verified JWT subject established by auth
      // middleware. The x-user-id header is client-supplied and trivially
      // spoofed, so it is deliberately not consulted here.
      const userId = (req as any).user?.id || (req as any).authUserId;
      if (userId) {
        const userKey = `${keyPrefix}:usr:${userId}`;
        if (!slidingWindowCheck(userKey, windowMs, maxPerUser)) {
          res.setHeader("Retry-After", String(Math.ceil(windowMs / 1000)));
          return res.status(429).json({ error: "rate_limit_exceeded" });
        }
      }
    }

    next();
  };
}

// Pre-configured tiers

/** Public verification & share endpoints – strict */
export const rateLimitShare = rateLimit({
  windowMs: 60_000,
  maxPerIp: 20,
  keyPrefix: "share",
});

/** Authenticated write endpoints (credentials, drafts, bursts) */
export const rateLimitWrite = rateLimit({
  windowMs: 60_000,
  maxPerIp: 30,
  maxPerUser: 60,
  keyPrefix: "write",
});

/** Presign / media upload – moderate */
export const rateLimitPresign = rateLimit({
  windowMs: 60_000,
  maxPerIp: 20,
  maxPerUser: 40,
  keyPrefix: "presign",
});

/** Global catch-all – generous */
export const rateLimitGlobal = rateLimit({
  windowMs: 60_000,
  maxPerIp: 120,
  keyPrefix: "global",
});
