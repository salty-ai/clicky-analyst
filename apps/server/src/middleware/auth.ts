import type { Context, Next } from "hono";
import type { AppContext } from "../types";

const BEARER_PREFIX = "Bearer ";

export function constantTimeEqual(a: string, b: string): boolean {
  const encoder = new TextEncoder();
  const aBytes = encoder.encode(a);
  const bBytes = encoder.encode(b);

  const maxLength = Math.max(aBytes.length, bBytes.length);
  let diff = aBytes.length ^ bBytes.length;
  for (let i = 0; i < maxLength; i++) {
    diff |= (aBytes[i] ?? 0) ^ (bBytes[i] ?? 0);
  }
  return diff === 0;
}

export function requireAuth(c: Context<AppContext>, next: Next) {
  const secret = c.env.APP_AUTH_SECRET;
  if (!secret) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const header = c.req.header("Authorization") ?? "";
  const token = header.startsWith(BEARER_PREFIX) ? header.slice(BEARER_PREFIX.length) : "";

  if (!token || !constantTimeEqual(token, secret)) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  c.set("userId", "local");
  return next();
}
