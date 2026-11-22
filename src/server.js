
import express from "express";
import cors from "cors";
import helmet from "helmet";
import { rateLimit } from "express-rate-limit";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import swaggerUi from "swagger-ui-express";

import { env } from "./config/env.js";
import api from "./routes/api.js";
import aiRoutes from "./routes/ai.js";
import { errors } from "./middleware/errors.js";

export const app = express();

// Security settings
app.disable("x-powered-by");
app.set("trust proxy", 1);
app.use(helmet());

// Request ID middleware
app.use((req, res, next) => {
  req.id = randomUUID();
  res.setHeader("X-Request-ID", req.id);
  next();
});

// CORS configuration
app.use(
  cors({
    origin: (origin, callback) => {
      const allowed =
        !origin || env.corsOrigins.includes(origin);

      callback(null, allowed);
    },
  })
);

// Rate limiting for authentication
app.use(
  "/api/v1/auth",
  rateLimit({
    windowMs: 15 * 60 * 1000,
    limit: 50,
    standardHeaders: "draft-8",
    legacyHeaders: false,
  })
);

// Parse JSON requests
app.use(express.json({ limit: "100kb" }));

// Gemini AI routes
// POST /api/v1/ai/discover
app.use("/api/v1/ai", aiRoutes);

// Existing Casio Shop API routes
app.use("/api/v1", api);

// Root endpoint
app.get("/", (req, res) => {
  res.json({
    service: "Casio Watch Store API",
    version: "v1",
    docs: "/api-docs",
  });
});

// Swagger API documentation
const openapi = JSON.parse(
  readFileSync(
    new URL("../openapi.json", import.meta.url),
    "utf8"
  )
);

app.use(
  "/api-docs",
  swaggerUi.serve,
  swaggerUi.setup(openapi)
);

// Handle unknown routes
app.use((req, res) => {
  res.status(404).json({
    success: false,
    error: {
      code: "NOT_FOUND",
      message: "Endpoint not found",
    },
    requestId: req.id,
  });
});

// Centralized error handler
app.use(errors);

// Start server
if (process.env.NODE_ENV !== "test") {
  app.listen(env.port, () => {
    console.log(
      `Casio API running at http://localhost:${env.port}`
    );
  });
}
