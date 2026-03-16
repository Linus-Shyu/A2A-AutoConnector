import axios from "axios";
import type { Request, Response } from "express";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { log } from "./logs.js";

export type TokenData = {
  access_token: string;
  token_type?: string;
  refresh_token?: string;
  scope?: string | string[];
  expires_in?: number;
  expires_at?: number; // epoch ms
};

const tokenPath = path.join(process.cwd(), "token.json");

export async function readToken(): Promise<TokenData | null> {
  try {
    const raw = await fs.readFile(tokenPath, "utf-8");
    return JSON.parse(raw) as TokenData;
  } catch {
    return null;
  }
}

export async function writeToken(token: TokenData): Promise<void> {
  await fs.writeFile(tokenPath, JSON.stringify(token, null, 2), "utf-8");
}

function requiredEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env ${name}`);
  return v;
}

function base64Url(input: Buffer): string {
  return input
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function createPkcePair(): { verifier: string; challenge: string } {
  const verifier = base64Url(crypto.randomBytes(32));
  const challenge = base64Url(crypto.createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

type PendingAuth = {
  state: string;
  code_verifier: string;
  created_at: number;
};

const pendingAuthPath = path.join(process.cwd(), ".oauth_pending.json");

async function writePendingAuth(p: PendingAuth): Promise<void> {
  await fs.writeFile(pendingAuthPath, JSON.stringify(p, null, 2), "utf-8");
}

async function readPendingAuth(): Promise<PendingAuth | null> {
  try {
    const raw = await fs.readFile(pendingAuthPath, "utf-8");
    return JSON.parse(raw) as PendingAuth;
  } catch {
    return null;
  }
}

async function clearPendingAuth(): Promise<void> {
  try {
    await fs.unlink(pendingAuthPath);
  } catch {
    // ignore
  }
}

export function handleLogin(req: Request, res: Response) {
  const clientId = requiredEnv("OAUTH_CLIENT_ID");
  const authUrl = requiredEnv("OAUTH_AUTH_URL");
  const redirectUri = requiredEnv("OAUTH_REDIRECT_URI");
  const scope = process.env.OAUTH_SCOPE;

  const { verifier, challenge } = createPkcePair();
  const state = base64Url(crypto.randomBytes(18));

  void writePendingAuth({ state, code_verifier: verifier, created_at: Date.now() });
  log("准备授权：跳转到 Second Me OAuth 登录页…");

  const u = new URL(authUrl);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", clientId);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("state", state);
  if (scope) u.searchParams.set("scope", scope);
  u.searchParams.set("code_challenge_method", "S256");
  u.searchParams.set("code_challenge", challenge);

  res.redirect(u.toString());
}

type TokenEnvelope = {
  code?: number;
  message?: string;
  subCode?: string;
  data?: {
    accessToken?: string;
    refreshToken?: string;
    tokenType?: string;
    expiresIn?: number;
    scope?: string[] | string;
  };
};

function normalizeTokenResponse(payload: unknown): TokenData {
  const p = payload as any;
  // Docs format: { code: 0, data: { accessToken, refreshToken, tokenType, expiresIn, scope } }
  if (p && typeof p === "object" && "data" in p) {
    const env = payload as TokenEnvelope;
    if (typeof env.code === "number" && env.code !== 0) {
      throw new Error(env.subCode ? `${env.subCode}` : env.message || "OAuth token exchange failed");
    }
    const d = env.data ?? {};
    if (!d.accessToken) throw new Error("Token response missing accessToken");
    return {
      access_token: d.accessToken,
      refresh_token: d.refreshToken,
      token_type: d.tokenType,
      expires_in: d.expiresIn,
      scope: d.scope
    };
  }

  // Fallback: raw OAuth token fields (some providers)
  if (typeof p?.access_token === "string") return p as TokenData;
  throw new Error("Unrecognized token response format");
}

export async function handleCallback(req: Request, res: Response) {
  const tokenUrl = requiredEnv("OAUTH_TOKEN_URL");
  const clientId = requiredEnv("OAUTH_CLIENT_ID");
  const clientSecret = process.env.OAUTH_CLIENT_SECRET;
  const redirectUri = requiredEnv("OAUTH_REDIRECT_URI");

  const code = typeof req.query.code === "string" ? req.query.code : null;
  const state = typeof req.query.state === "string" ? req.query.state : null;
  if (!code) {
    res.status(400).send("Missing code");
    return;
  }

  const pending = await readPendingAuth();
  if (!pending || !state || pending.state !== state) {
    res.status(400).send("Invalid state");
    return;
  }

  log("OAuth 回调已收到，正在交换 access_token…");
  const body = new URLSearchParams();
  body.set("grant_type", "authorization_code");
  body.set("code", code);
  body.set("redirect_uri", redirectUri);
  body.set("client_id", clientId);
  body.set("code_verifier", pending.code_verifier);
  if (clientSecret) body.set("client_secret", clientSecret);

  const r = await axios.post(tokenUrl, body.toString(), {
    headers: { "Content-Type": "application/x-www-form-urlencoded" }
  });

  const token = normalizeTokenResponse(r.data);
  const expiresAt =
    typeof token.expires_in === "number" ? Date.now() + token.expires_in * 1000 : undefined;

  await writeToken({
    ...token,
    expires_at: expiresAt
  });
  await clearPendingAuth();

  log("授权成功：token 已保存，分身准备上线。");
  res.redirect("/?authorized=1");
}

async function maybeRefreshAccessToken(t: TokenData): Promise<TokenData> {
  if (!t.refresh_token) return t;
  if (!t.expires_at) return t;
  // refresh a bit early
  const skewMs = 60_000;
  if (Date.now() < t.expires_at - skewMs) return t;

  const refreshUrl = process.env.OAUTH_REFRESH_URL;
  if (!refreshUrl) return t;

  log("access_token 可能已过期，正在使用 refresh_token 刷新…");

  const clientId = requiredEnv("OAUTH_CLIENT_ID");
  const clientSecret = process.env.OAUTH_CLIENT_SECRET;

  const body = new URLSearchParams();
  body.set("grant_type", "refresh_token");
  body.set("refresh_token", t.refresh_token);
  body.set("client_id", clientId);
  if (clientSecret) body.set("client_secret", clientSecret);

  const r = await axios.post(refreshUrl, body.toString(), {
    headers: { "Content-Type": "application/x-www-form-urlencoded" }
  });

  const newToken = normalizeTokenResponse(r.data);
  const expiresAt =
    typeof newToken.expires_in === "number"
      ? Date.now() + newToken.expires_in * 1000
      : t.expires_at;

  const merged: TokenData = {
    ...t,
    ...newToken,
    expires_at: expiresAt
  };
  await writeToken(merged);
  log("token 刷新成功。");
  return merged;
}

export async function getAccessTokenOrThrow(): Promise<string> {
  const t0 = await readToken();
  if (!t0?.access_token) throw new Error("No token yet. Visit /login to authorize.");
  const t = await maybeRefreshAccessToken(t0);
  if (!t.access_token) throw new Error("Token missing access_token after refresh.");
  return t.access_token;
}

