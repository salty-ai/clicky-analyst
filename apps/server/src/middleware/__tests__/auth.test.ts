import { describe, expect, it } from "vitest";
import { Hono } from "hono";
import { constantTimeEqual, requireAuth } from "../auth";
import type { AppContext } from "../../types";

describe("constantTimeEqual", () => {
  it("returns true for identical strings", () => {
    expect(constantTimeEqual("secret", "secret")).toBe(true);
  });

  it("returns false for different strings of the same length", () => {
    expect(constantTimeEqual("secret", "secreX")).toBe(false);
  });

  it("returns false for different lengths", () => {
    expect(constantTimeEqual("secret", "secret-longer")).toBe(false);
    expect(constantTimeEqual("secret-longer", "secret")).toBe(false);
  });

  it("returns false for empty vs non-empty", () => {
    expect(constantTimeEqual("", "x")).toBe(false);
  });

  it("returns true for two empty strings", () => {
    expect(constantTimeEqual("", "")).toBe(true);
  });

  it("handles non-ASCII safely", () => {
    expect(constantTimeEqual("sécřet-🔑", "sécřet-🔑")).toBe(true);
    expect(constantTimeEqual("sécřet-🔑", "sécřet-🔒")).toBe(false);
  });
});

function makeApp(secret?: string) {
  const app = new Hono<AppContext>();
  app.use("*", async (c, next) => {
    const env = secret === undefined ? {} : { APP_AUTH_SECRET: secret };
    Object.assign(c, { env });
    await next();
  });
  app.post("/chat", requireAuth, (c) => c.json({ ok: true, userId: c.get("userId") }));
  return app;
}

describe("requireAuth", () => {
  it("fails closed when APP_AUTH_SECRET is unset", async () => {
    const app = makeApp(undefined);
    const res = await app.request("/chat", {
      method: "POST",
      headers: { Authorization: "Bearer anything" },
    });
    expect(res.status).toBe(401);
  });

  it("rejects when Authorization header is missing", async () => {
    const app = makeApp("s3cret");
    const res = await app.request("/chat", { method: "POST" });
    expect(res.status).toBe(401);
  });

  it("rejects a wrong token", async () => {
    const app = makeApp("s3cret");
    const res = await app.request("/chat", {
      method: "POST",
      headers: { Authorization: "Bearer wrong" },
    });
    expect(res.status).toBe(401);
  });

  it("rejects a token with different length", async () => {
    const app = makeApp("s3cret");
    const res = await app.request("/chat", {
      method: "POST",
      headers: { Authorization: "Bearer s3cret-extra" },
    });
    expect(res.status).toBe(401);
  });

  it("rejects non-Bearer schemes", async () => {
    const app = makeApp("s3cret");
    const res = await app.request("/chat", {
      method: "POST",
      headers: { Authorization: "Basic s3cret" },
    });
    expect(res.status).toBe(401);
  });

  it("accepts the correct Bearer token and sets userId=local", async () => {
    const app = makeApp("s3cret");
    const res = await app.request("/chat", {
      method: "POST",
      headers: { Authorization: "Bearer s3cret" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean; userId: string };
    expect(body).toEqual({ ok: true, userId: "local" });
  });
});
