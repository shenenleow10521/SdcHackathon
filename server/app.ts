// Express app. Routes are grouped by feature; each module exports (svc) => Router.
import express from "express";
import path from "node:path";
import { clerkMiddleware } from "@clerk/express";
import { HttpError } from "./lib/http.ts";
import { projectRoot } from "./lib/db.ts";
import type { Services } from "./context.ts";
import graphRoutes from "./routes/graph.ts";
import healthRoutes from "./routes/health.ts";
import profileRoutes from "./routes/profile.ts";
import planRoutes from "./routes/plan.ts";
import knowledgeRoutes from "./routes/knowledge.ts";
import employerRoutes from "./routes/employers.ts";
import exposureRoutes from "./routes/exposure.ts";
import escoRoutes from "./routes/esco.ts";
import escoNetworkRoutes from "./routes/esco-network.ts";
import accountRoutes from "./routes/account.ts";
import { authenticate, profileGuard, intakeGuard } from "./lib/auth.ts";
import { CLERK_PROXY_PATH, clerkProxyMiddleware } from "./middlewares/clerkProxyMiddleware.ts";
import { guestSessionMiddleware } from "./middlewares/guestSession.ts";

export function createApp(svc: Services) {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use(CLERK_PROXY_PATH, clerkProxyMiddleware());
  if (svc.config.clerkEnabled && !svc.auth) app.use(clerkMiddleware());
  if (svc.config.clerkEnabled && svc.config.guestSessionSecret) app.use("/api", guestSessionMiddleware(svc.config.guestSessionSecret));
  app.use(express.json({ limit: "2mb" }));
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    next();
  });

  const api = express.Router();
  // Accounts: who is asking (Clerk session), then ownership checks on anything that names a profile.
  api.use(authenticate(svc));
  api.use(profileGuard(svc));
  api.use(intakeGuard(svc));
  api.use(accountRoutes(svc));
  api.use(healthRoutes(svc));
  api.use(graphRoutes(svc));
  api.use(profileRoutes(svc));
  api.use(planRoutes(svc));
  api.use(knowledgeRoutes(svc));
  api.use(employerRoutes(svc));
  api.use(exposureRoutes(svc));
  api.use(escoNetworkRoutes(svc));
  api.use(escoRoutes(svc));
  api.use((req, _res, next) => next(new HttpError(404, "not_found", `No API route: ${req.method} ${req.path}`)));
  app.use("/api", api);

  app.use("/shared", express.static(path.join(projectRoot, "shared")));
  // "/" is the landing page; the app lives at "/app" (its asset paths are absolute, so "/app/" works too).
  const web = path.join(projectRoot, "web");
  app.use("/vendor/clerk", express.static(path.join(projectRoot, "node_modules", "@clerk", "clerk-js", "dist"), { fallthrough: true }));
  app.get("/", (_req, res) => res.sendFile(path.join(web, "landing.html")));
  app.get(["/app", "/app/"], (_req, res) => res.sendFile(path.join(web, "index.html")));
  app.use(express.static(web, { index: false }));

  // Errors: JSON with a stable shape { error: { code, message, details? } }. No stack traces to clients.
  app.use((err: any, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    if (err?.type === "entity.parse.failed") return res.status(400).json({ error: { code: "bad_json", message: "Request body is not valid JSON" } });
    if (err?.type === "entity.too.large") return res.status(413).json({ error: { code: "too_large", message: "Request body is too large" } });
    const status = Number(err?.status || err?.statusCode) || 500;
    const code = typeof err?.code === "string" && status < 500 ? err.code : status === 503 ? (err?.code || "unavailable") : status >= 500 ? "internal" : "error";
    if (status >= 500 && process.env.NODE_ENV !== "test") console.error(err);
    res.status(status).json({ error: { code, message: status === 500 ? "Something went wrong on our side" : err.message, details: err.details } });
  });
  return app;
}
