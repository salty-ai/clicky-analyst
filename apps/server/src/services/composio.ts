import { Composio } from "@composio/core";
import { VercelProvider } from "@composio/vercel";
import type { Env } from "../types";

export function makeComposio(env: Env) {
  if (!env.COMPOSIO_API_KEY) {
    return undefined;
  }

  return new Composio({
    apiKey: env.COMPOSIO_API_KEY,
    provider: new VercelProvider({ strict: true }),
  });
}

export async function getToolsForUser(env: Env, userId: string) {
  const composio = makeComposio(env);
  if (!composio) {
    return undefined;
  }

  const accounts = await composio.connectedAccounts.list({
    userIds: [userId],
  });
  const activeToolkits = Array.from(
    new Set(
      accounts.items
        .filter((account) => account.status === "ACTIVE")
        .map((account) => account.toolkit.slug)
    )
  );

  if (activeToolkits.length === 0) {
    return undefined;
  }

  const tools = await composio.tools.get(
    userId,
    {
      toolkits: activeToolkits,
      limit: 50,
    },
    {
      modifySchema: ({ schema }) => ({
        ...schema,
        description: addToolUseProtocol(schema.description),
      }),
    }
  );

  return { tools, activeToolkits };
}

function addToolUseProtocol(description: string | undefined): string {
  const protocol = "Tool-use protocol: use this external app tool only when the user explicitly asks to act in this app/toolkit or manage external app data. Do not use app tools for screen pointing, cursor movement, coordinates, visual navigation, UI help, or general conversation. Use exact user-provided values; do not invent external resource IDs/names; search/list/get first when required IDs or containers are missing; retry safely after recoverable errors; only report success when the tool result is successful.";
  return description ? `${description}\n\n${protocol}` : protocol;
}
