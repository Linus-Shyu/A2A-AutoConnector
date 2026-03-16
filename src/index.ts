import "dotenv/config";
import express from "express";
import cron from "node-cron";
import { handleCallback, handleLogin, readToken } from "./auth.js";
import { runOnce } from "./agent.js";
import { formatTime, getLogs, log, onLog } from "./logs.js";
import path from "node:path";

function requiredEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

const app = express();

app.use(express.static(path.join(process.cwd(), "public")));

app.get("/api/status", async (_req, res) => {
  const token = await readToken();
  res.status(200).json({ authorized: Boolean(token?.access_token) });
});

app.get("/api/logs", (_req, res) => {
  const lines = getLogs().map((l) => `[${formatTime(l.ts)}] ${l.msg}`);
  res.status(200).json({ lines });
});

app.get("/events", (req, res) => {
  res.setHeader("Content-Type", "text/event-stream");
  res.setHeader("Cache-Control", "no-cache");
  res.setHeader("Connection", "keep-alive");
  res.flushHeaders?.();

  const send = (s: string) => {
    res.write(`data: ${s.replace(/\n/g, "\\n")}\n\n`);
  };

  // Send last few lines immediately
  for (const l of getLogs().slice(-30)) send(`[${formatTime(l.ts)}] ${l.msg}`);

  const off = onLog((l) => send(`[${formatTime(l.ts)}] ${l.msg}`));
  req.on("close", () => {
    off();
    res.end();
  });
});

app.get("/login", handleLogin);
app.get("/callback", (req, res) => {
  void handleCallback(req, res);
});
// Compatibility with common NextAuth-style callback path used in hackathon docs
app.get("/api/auth/callback", (req, res) => {
  void handleCallback(req, res);
});

app.post("/run-once", async (_req, res) => {
  try {
    const result = await runOnce();
    res.status(200).json({ ok: true, result });
  } catch (err) {
    res.status(500).json({ ok: false, error: err instanceof Error ? err.message : String(err) });
  }
});

const port = Number(process.env.PORT ?? 3000);
app.listen(port, () => {
  console.log(`[A2A-AutoConnector] listening on :${port}`);
  log(`Web UI 已启动：http://localhost:${port}`);
});

const schedule = process.env.CRON_SCHEDULE ?? "*/30 * * * *";

function isConfigured(): boolean {
  try {
    requiredEnv("SECONDME_API_BASE_URL");
    requiredEnv("OAUTH_CLIENT_ID");
    requiredEnv("OAUTH_AUTH_URL");
    requiredEnv("OAUTH_TOKEN_URL");
    requiredEnv("OAUTH_REDIRECT_URI");
    return true;
  } catch {
    return false;
  }
}

async function tick(): Promise<void> {
  try {
    const r = await runOnce();
    console.log(
      `[A2A-AutoConnector] runOnce ok my=${r.my_shade_id} searched=${r.searched} new=${r.newly_chatted} skipped=${r.skipped_already_chatted}`
    );
  } catch (err) {
    console.error(
      "[A2A-AutoConnector] runOnce failed",
      err instanceof Error ? err.message : err
    );
  }
}

if (!isConfigured()) {
  console.warn("[A2A-AutoConnector] missing env config; server is up but cron may fail.");
  log("环境变量未配置完整：可先访问页面进行配置与授权（cron 可能会失败）。");
} else {
  cron.schedule(schedule, () => void tick(), { timezone: "UTC" });
  console.log(`[A2A-AutoConnector] cron scheduled: ${schedule} (UTC)`);
  log(`定时任务已启动：每 30 分钟执行一次（${schedule}, UTC）`);
}

// Optional immediate run at boot if already authorized
void (async () => {
  const token = await readToken();
  if (token?.access_token) await tick();
})();

