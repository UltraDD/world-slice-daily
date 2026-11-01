import { z } from "zod";
import { defineQueue, defineServerModule } from "@aihot/backend/modules";
import { enqueueOn } from "@aihot/backend/jobs/queue";
import { config } from "@aihot/backend/config";
import { loadDaily, decideIdea } from "./backend/publication.ts";
import { runDaily } from "./backend/pipeline.ts";

export const dailyQueue = defineQueue<{ force: boolean }>({
  name: "creator-daily.generate", options: { retryLimit: 0, expireInSeconds: 1200 },
  worker: { batchSize: 1 }, run: async jobs => { for (const job of jobs) await runDaily(job); },
});

export default defineServerModule({
  name: "creator-daily", queues: [dailyQueue],
  schedules: [{ name: "creator-daily", cron: "0 10 * * *", missed: "once",
    when: () => process.env.MODEL_CALLS_ENABLED === "true" && process.env.COLLECT_ENABLED === "true", run: () => runDaily() }],
  http(app) {
    app.get("/api/creator/today", async (_req, reply) => reply.header("Cache-Control", "no-store").send(await loadDaily()));
    app.addHook("preHandler", async (req, reply) => {
      if (!req.url.startsWith("/api/creator/") || ["GET", "HEAD"].includes(req.method)) return;
      const origin = req.headers.origin;
      const ip = req.raw.socket.remoteAddress;
      if (!["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(ip ?? "") ||
        (origin && origin !== config.siteUrl) || !req.headers["content-type"]?.startsWith("application/json")) {
        return reply.code(403).send({ error: "请从本机选题页面操作" });
      }
    });
    app.post("/api/creator/refresh", async (_req, reply) => {
      const page = await loadDaily();
      if (page.latestRun && ["collecting", "generating"].includes(page.latestRun.status) && Date.now() - Date.parse(page.latestRun.started_at) < 1_200_000) return reply.code(202).send({ status: "running" });
      await enqueueOn(dailyQueue, { force: true }, { singletonKey: "daily" });
      return reply.code(202).send({ status: "queued" });
    });
    app.post("/api/creator/decision", async (req, reply) => {
      const parsed = z.object({ id: z.string().regex(/^[a-f0-9]{24}$/), decision: z.enum(["new", "saved", "dismissed"]) }).safeParse(req.body);
      if (!parsed.success) return reply.code(400).send({ error: "选题状态无效" });
      const found = await decideIdea(parsed.data.id, parsed.data.decision);
      return found ? { ok: true } : reply.code(404).send({ error: "选题已不存在，请刷新" });
    });
  },
});
