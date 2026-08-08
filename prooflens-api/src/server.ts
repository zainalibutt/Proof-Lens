// API server entry point.
import express, { Request, Response, NextFunction } from "express";
import cors from "cors";
import helmet from "helmet";
import morgan from "morgan";
import "./types"; // augment Express.Request globally
import { rateLimitGlobal } from "./utils/rateLimit";
import { attachAuthUser } from "./services/device";

// Routes
import healthRoutes from "./routes/health";
import deviceRoutes from "./routes/devices";
import mediaRoutes from "./routes/media";
import verifyRoutes from "./routes/verify";
import captureRoutes from "./routes/captures";
import shareRoutes from "./routes/shares";
import audioRoutes from "./routes/audio";
import credentialRoutes from "./routes/credentials";
import draftRoutes from "./routes/drafts";
import burstRoutes from "./routes/bursts";

// Env
const {
  PORT = "8080",
  CORS_ORIGIN,
} = process.env as Record<string, string | undefined>;

function resolveCorsOrigin() {
  // A wildcard origin is refused outright. Share links are public but are
  // authorised by a signed token, not by a permissive CORS policy, so there is
  // never a legitimate reason to reflect any origin.
  if (CORS_ORIGIN && CORS_ORIGIN.trim() === "*") {
    throw new Error(
      "CORS_ORIGIN=* is not permitted. Set an explicit comma-separated allowlist of origins."
    );
  }

  const configured = String(CORS_ORIGIN || "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);

  if (configured.length > 0) {
    return configured.length === 1 ? configured[0] : configured;
  }

  // Default allowed origins.
  return [
    "https://proof-lens.vercel.app",
    "http://localhost:5173",
    "http://127.0.0.1:5173",
  ];
}

// App
const app = express();

// Bound how much of x-forwarded-for is believed. Railway terminates TLS and
// adds a single hop, so exactly one proxy is trusted. Without this, req.ip is
// the socket address and the header is ignored entirely — both are safe; what
// is unsafe is reading the raw header directly (see utils/rateLimit.ts).
app.set("trust proxy", 1);

app.use(
  helmet({
    // API serves JSON and presigned redirects, not HTML, so a restrictive
    // default CSP is appropriate.
    contentSecurityPolicy: {
      useDefaults: true,
      directives: { "default-src": ["'none'"], "frame-ancestors": ["'none'"] },
    },
    crossOriginResourcePolicy: { policy: "same-site" },
    referrerPolicy: { policy: "no-referrer" },
  })
);

app.use(
  cors({
    origin: resolveCorsOrigin(),
    credentials: false,
    methods: ["GET", "POST", "PATCH", "DELETE", "OPTIONS"],
  })
);
app.use(express.json({ limit: "10mb" }));
// Log the path only. Full URLs can carry share/bundle tokens in the query
// string, which must never reach persistent logs.
morgan.token("safepath", (req: any) => {
  const raw = String(req.originalUrl || req.url || "");
  const q = raw.indexOf("?");
  return q === -1 ? raw : raw.slice(0, q) + "?<redacted>";
});
app.use(morgan(":method :safepath :status :res[content-length] - :response-time ms"));

// Global rate limiter
app.use(rateLimitGlobal);
// Populate a verified subject before route-level per-user rate limiters run.
app.use(attachAuthUser);

// Route wiring
app.use(healthRoutes);
app.use(deviceRoutes);
app.use(mediaRoutes);
app.use(verifyRoutes);
app.use(captureRoutes);
app.use(shareRoutes);
app.use(audioRoutes);
app.use(credentialRoutes);
app.use(draftRoutes);
app.use(burstRoutes);

// Error handler
app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
  console.error("[server] unhandled:", err);
  res.status(500).json({ error: "server_error" });
});

// Start
const numPort = Number(PORT);
app.listen(numPort, "0.0.0.0", () => console.log(`API :${numPort}`));
