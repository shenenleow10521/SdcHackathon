// Entry point: build services, start the HTTP server and the scheduled market scout.
import { createServices } from "./services.ts";
import { createApp } from "./app.ts";
import { startScheduler } from "./services/scheduler.ts";

const svc = await createServices();
const app = createApp(svc);
const server = app.listen(svc.config.port, "0.0.0.0", () => {
  const llm = svc.llm.status(), emb = svc.embed.status();
  console.log(`HalaTuju on http://localhost:${svc.config.port}  db=${svc.db.kind}  llm=${llm.configured ? llm.models.main : "off"}  embed=${emb.provider}  demo=${svc.config.demoMode}`);
});
const stopScheduler = startScheduler(svc);
// A RunPod worker scales to zero when idle and takes about a minute to start, so wake it in the background now.
if (svc.embed.provider === "runpod-bge-m3") svc.embed.embed([`warm-up ${Date.now()}`]).catch(() => {});

const shutdown = async () => { stopScheduler(); server.close(); await svc.db.close(); process.exit(0); };
process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
