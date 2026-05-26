import { getAuth } from "@clerk/hono";
import type { Context } from "hono";
import { makeComposio } from "../services/composio";
import type { AppContext } from "../types";

export async function handleToolkitStatuses(c: Context<AppContext>): Promise<Response> {
  const { userId } = getAuth(c);
  if (!userId) {
    return c.json({ error: "Unauthorized" }, 401);
  }

  const body = await c.req.json().catch(() => ({})) as { toolkits?: unknown };
  const toolkits = Array.isArray(body.toolkits)
    ? [...new Set(body.toolkits.filter((toolkit): toolkit is string => typeof toolkit === "string").map(normalizedToolkitSlug).filter(Boolean))]
    : [];

  if (toolkits.length === 0) {
    return c.json({ configured: true, statuses: {} });
  }

  const composio = makeComposio(c.env);
  if (!composio) {
    return c.json({
      configured: false,
      statuses: Object.fromEntries(toolkits.map((toolkit) => [toolkit, { toolkit, connected: false, configured: false }])),
    });
  }

  // One Composio API call for every requested toolkit instead of one call per toolkit.
  const accounts = await composio.connectedAccounts.list({
    userIds: [userId],
    toolkitSlugs: toolkits,
  });
  const accountByToolkit = new Map(accounts.items.map((account) => [account.toolkit.slug, account]));

  return c.json({
    configured: true,
    statuses: Object.fromEntries(toolkits.map((toolkit) => [toolkit, statusPayload(toolkit, accountByToolkit.get(toolkit))])),
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

function statusPayload(toolkit: string, connectedAccount: { id: string; status?: string; toolkit: { slug: string } } | undefined) {
  return {
    toolkit,
    configured: true,
    connected: connectedAccount?.status === "ACTIVE",
    status: connectedAccount?.status ?? "NOT_CONNECTED",
    connectedAccountId: connectedAccount?.id,
  };
}

function toolkitParam(c: Context<AppContext>): string {
  const toolkit = c.req.param("toolkit");
  if (!toolkit) {
    throw new Error("Missing toolkit");
  }

  return normalizedToolkitSlug(toolkit);
}
