/**
 * Replit-managed Clerk Frontend API proxy.
 * Required in production custom-domain deployments; no-op in development.
 */
import type { IncomingHttpHeaders } from "node:http";
import type { RequestHandler } from "express";
import { createProxyMiddleware } from "http-proxy-middleware";

const CLERK_FAPI = "https://frontend-api.clerk.dev";
export const CLERK_PROXY_PATH = "/api/__clerk";

export function getClerkProxyHost(req: { headers: IncomingHttpHeaders }): string | undefined {
  const forwarded = req.headers["x-forwarded-host"];
  const raw = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const firstHop = raw?.split(",")[0]?.trim();
  return firstHop || req.headers.host?.trim() || undefined;
}

export function clerkProxyMiddleware(): RequestHandler {
  if (process.env.NODE_ENV !== "production" || !process.env.CLERK_SECRET_KEY) {
    return (_req, _res, next) => next();
  }
  return createProxyMiddleware({
    target: CLERK_FAPI,
    changeOrigin: true,
    selfHandleResponse: true,
    pathRewrite: path => path.replace(new RegExp(`^${CLERK_PROXY_PATH}`), ""),
    on: {
      proxyReq: (proxyReq, req) => {
        const protocol = req.headers["x-forwarded-proto"] || "https";
        const host = getClerkProxyHost(req) || "";
        proxyReq.setHeader("Clerk-Proxy-Url", `${protocol}://${host}${CLERK_PROXY_PATH}`);
        proxyReq.setHeader("Clerk-Secret-Key", process.env.CLERK_SECRET_KEY!);
        const xff = req.headers["x-forwarded-for"];
        const clientIp = (Array.isArray(xff) ? xff[0] : xff)?.split(",")[0]?.trim() || req.socket?.remoteAddress || "";
        if (clientIp) proxyReq.setHeader("X-Forwarded-For", clientIp);
      },
      proxyRes: (proxyRes, req, res) => {
        const headers = { ...proxyRes.headers };
        delete headers["transfer-encoding"]; delete headers.connection; delete headers["keep-alive"];
        const status = proxyRes.statusCode ?? 502;
        if (status < 200 || status === 204) delete headers["content-length"];
        if (req.method === "HEAD" || status < 200 || status === 204 || status === 304) {
          proxyRes.on("error", () => res.destroy());
          res.writeHead(status, headers); proxyRes.pipe(res); return;
        }
        if (headers["content-length"] !== undefined) {
          proxyRes.on("error", () => res.destroy());
          res.writeHead(status, headers); proxyRes.pipe(res); return;
        }
        const chunks: Buffer[] = [];
        proxyRes.on("data", chunk => chunks.push(chunk));
        proxyRes.on("end", () => {
          const body = Buffer.concat(chunks);
          headers["content-length"] = String(body.length);
          res.writeHead(status, headers); res.end(body);
        });
        proxyRes.on("error", () => {
          if (!res.headersSent) res.writeHead(502, { "content-length": "0" });
          res.end();
        });
      },
    },
  }) as RequestHandler;
}
