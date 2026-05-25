import { getAuth } from "@clerk/hono";
import type { Context } from "hono";
import { makeComposio } from "../services/composio";
import type { AppContext } from "../types";

export async function handleToolkitStatus(c: Context<AppContext>): Promise<Response> {
  const { userId } = getAuth(c);
  if (!userId) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const toolkit = toolkitParam(c);
  const composio = makeComposio(c.env);
  if (!composio) {
    return c.json({ toolkit, connected: false, configured: false });
  }

  const accounts = await composio.connectedAccounts.list({
    userIds: [userId],
    toolkitSlugs: [toolkit],
  });
  const connectedAccount = accounts.items.find((account) => account.toolkit.slug === toolkit);

  return c.json({
    toolkit,
    configured: true,
    connected: connectedAccount?.status === "ACTIVE",
    status: connectedAccount?.status ?? "NOT_CONNECTED",
    connectedAccountId: connectedAccount?.id,
  });
}

export async function handleToolkitConnect(c: Context<AppContext>): Promise<Response> {
  const { userId } = getAuth(c);
  if (!userId) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const toolkit = toolkitParam(c);
  const composio = makeComposio(c.env);
  if (!composio) {
    return c.json({ error: "COMPOSIO_API_KEY is not configured" }, 500);
  }

  const authConfigs = await composio.authConfigs.list({ toolkit });
  const authConfig = authConfigs.items[0] ?? await composio.authConfigs.create(toolkit);

  const connection = await composio.connectedAccounts.link(userId, authConfig.id, {
    callbackUrl: "glide://composio/callback",
  });

  return c.json({
    toolkit,
    redirectUrl: connection.redirectUrl,
    connectionRequestId: connection.id,
  });
}

export async function handleToolkitDisconnect(c: Context<AppContext>): Promise<Response> {
  const { userId } = getAuth(c);
  if (!userId) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const toolkit = toolkitParam(c);
  const composio = makeComposio(c.env);
  if (!composio) {
    return c.json({ error: "COMPOSIO_API_KEY is not configured" }, 500);
  }

  const accounts = await composio.connectedAccounts.list({
    userIds: [userId],
    toolkitSlugs: [toolkit],
  });
  const connectedAccounts = accounts.items.filter((account) => account.toolkit.slug === toolkit);

  await Promise.all(connectedAccounts.map((account) => composio.connectedAccounts.delete(account.id)));

  return c.json({
    toolkit,
    disconnected: true,
    deletedCount: connectedAccounts.length,
  });
}

function normalizedToolkitSlug(toolkit: string): string {
  return toolkit.trim().toLowerCase();
}

function toolkitParam(c: Context<AppContext>): string {
  const toolkit = c.req.param("toolkit");
  if (!toolkit) {
    throw new Error("Missing toolkit");
  }

  return normalizedToolkitSlug(toolkit);
}
