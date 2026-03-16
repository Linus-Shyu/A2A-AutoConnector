import axios, { type AxiosInstance } from "axios";
import fs from "node:fs/promises";
import path from "node:path";
import { getAccessTokenOrThrow } from "./auth.js";
import { log } from "./logs.js";

type Shade = {
  shade_id: string;
  tags?: string[];
  name?: string;
};

type SearchResult = {
  items?: Shade[];
  shades?: Shade[];
  results?: Shade[];
};

type ChattedState = {
  chatted_shade_ids: string[];
  updated_at: number;
};

const chattedPath = path.join(process.cwd(), "data", "chatted.json");

async function ensureDataDir(): Promise<void> {
  await fs.mkdir(path.join(process.cwd(), "data"), { recursive: true });
}

async function readChattedState(): Promise<Set<string>> {
  try {
    const raw = await fs.readFile(chattedPath, "utf-8");
    const parsed = JSON.parse(raw) as ChattedState;
    return new Set(parsed.chatted_shade_ids ?? []);
  } catch {
    return new Set();
  }
}

async function writeChattedState(set: Set<string>): Promise<void> {
  await ensureDataDir();
  const state: ChattedState = {
    chatted_shade_ids: Array.from(set),
    updated_at: Date.now()
  };
  await fs.writeFile(chattedPath, JSON.stringify(state, null, 2), "utf-8");
}

function requiredEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

async function apiClient(): Promise<AxiosInstance> {
  const baseURL = requiredEnv("SECONDME_API_BASE_URL");
  const token = await getAccessTokenOrThrow();
  return axios.create({
    baseURL,
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json"
    },
    timeout: 30_000
  });
}

export async function getMyShadeId(): Promise<string> {
  const api = await apiClient();
  log("正在获取主人当前分身（/v1/shades）…");
  const r = await api.get("/v1/shades");
  const data = r.data as unknown;

  const shades: Shade[] =
    (data as any)?.items ?? (data as any)?.shades ?? (Array.isArray(data) ? (data as any) : []);

  const first = shades?.[0];
  if (!first?.shade_id) throw new Error("Unable to determine my shade_id from /v1/shades");
  log(`已识别主人 shade_id=${first.shade_id}`);
  return first.shade_id;
}

function normalizeSearchItems(data: any): Shade[] {
  const sr = data as SearchResult;
  const items = sr.items ?? sr.shades ?? sr.results;
  return Array.isArray(items) ? items : [];
}

export async function searchDeveloperLikeAgents(): Promise<Shade[]> {
  const api = await apiClient();
  log("正在搜索标签为 Developer / Rust / Builder 的同类开发者…");
  const r = await api.post("/v1/shades/search", {
    tags: ["Developer", "Rust", "Builder"]
  });
  const items = normalizeSearchItems(r.data);
  log(`搜索完成：找到 ${items.length} 个候选分身`);
  return items;
}

export async function startA2AChat(targetShadeId: string): Promise<void> {
  const api = await apiClient();
  log(`准备发起 A2A 对话：target_shade_id=${targetShadeId}`);
  await api.post("/v1/a2a/chat", {
    target_shade_id: targetShadeId,
    prompt:
      "你好！我的主人是一个热爱技术的开发者，他最近在闭关写代码，特意派我来认识有趣的灵魂。期待与你的 Agent 交流。"
  });
  log(`已发起 A2A 对话：target_shade_id=${targetShadeId}`);
}

export async function runOnce(): Promise<{
  my_shade_id: string;
  searched: number;
  newly_chatted: number;
  skipped_already_chatted: number;
}> {
  await ensureDataDir();

  log("执行一次自动连接任务（runOnce）…");
  const myShadeId = await getMyShadeId();
  const results = await searchDeveloperLikeAgents();

  const chatted = await readChattedState();
  let newly = 0;
  let skipped = 0;

  for (const s of results) {
    const sid = s?.shade_id;
    if (!sid) continue;
    if (sid === myShadeId) continue;

    if (chatted.has(sid)) {
      skipped += 1;
      continue;
    }

    await startA2AChat(sid);
    chatted.add(sid);
    newly += 1;
    await writeChattedState(chatted);
  }

  log(`runOnce 完成：new=${newly} skipped=${skipped}`);
  return {
    my_shade_id: myShadeId,
    searched: results.length,
    newly_chatted: newly,
    skipped_already_chatted: skipped
  };
}

