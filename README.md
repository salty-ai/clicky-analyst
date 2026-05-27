# Glide

Glide started as a clone of [clicky](https://github.com/farzaa/clicky), a project by [Farza](https://x.com/FarzaTV). This repo extends that idea into a native macOS screen companion with authenticated cloud AI, speech, screen understanding, cursor pointing, and agent integrations for external apps like Notion, Google Docs, and more.

## What it does

Glide is a macOS menu bar companion that you talk to with push-to-talk. It can capture your screen, send the visual context plus your transcript to an AI model, answer out loud, and point at UI elements with an on screen cursor

The backend runs as a Cloudflare Worker and provides:

- authenticated chat streaming through the Vercel AI SDK AI Gateway
- AssemblyAI realtime transcription token generation
- Gradium text-to-speech proxying
- Composio-powered agent integrations for acting in connected external tools like Notion, Google Docs, Gmail, Slack, GitHub, and more
- Clerk authentication for the macOS app and server routes

## Monorepo structure

```txt
apps/
  macos/    Native Swift/AppKit macOS app
  server/   Hono Cloudflare Worker API
packages/
  config/   Shared TypeScript config
```

## Agent integrations with Composio

Glide includes agent integrations through Composio. Users can connect external apps such as Notion, Google Docs, Gmail, Slack, GitHub, and other Composio-supported toolkits, then ask Glide to take action in those apps.

The server uses `@composio/core` with the Composio Vercel provider. When a signed-in user asks Glide to work with an external app, the server checks that user's active Composio connected accounts and loads the relevant toolkit tools into the AI SDK `streamText` call. That lets the AI agent use connected-app tools only when the user explicitly asks for external-app work, such as creating a Notion page, finding a Google Doc, summarizing content, or updating information in a connected workspace.

Integration endpoints:

- `POST /integrations/statuses` — check whether requested toolkits are connected
- `POST /integrations/:toolkit/connect` — create a Composio connection link
- `DELETE /integrations/:toolkit/disconnect` — remove connected accounts for a toolkit

Composio OAuth returns to the macOS app using:

```txt
glide://composio/callback
```

Make sure this callback/deep-link scheme is allowed wherever your Composio integration setup requires redirect URLs.

## Required server environment

Set these for the Cloudflare Worker in `apps/server`. For local development you can use `apps/server/.dev.vars`; for deployed Workers use `wrangler secret put <NAME>` for secrets.

```bash
AI_GATEWAY_API_KEY=...
CLERK_SECRET_KEY=...
ASSEMBLYAI_API_KEY=...
GRADIUM_API_KEY=...
COMPOSIO_API_KEY=...

# Optional; defaults are also in wrangler.toml
GRADIUM_TTS_MODEL=default
GRADIUM_TTS_VOICE_ID=YTpq7expH9539ERJ
```

Notes:

- `AI_GATEWAY_API_KEY` is used by `createGateway()` for model calls.
- `CLERK_SECRET_KEY` is required by `@clerk/hono` to authenticate protected routes.
- `ASSEMBLYAI_API_KEY` is used by `/transcribe-token`.
- `GRADIUM_API_KEY` is used by `/tts`.
- `COMPOSIO_API_KEY` enables connected-account lookup, toolkit auth links, and AI tools.

## Required macOS app configuration

The macOS app reads these values from Xcode build settings injected into `apps/macos/Glide/Info.plist`:

```txt
GLIDE_SERVER_BASE_URL   # e.g. http://localhost:8787 or your deployed Worker URL
CLERK_PUBLISHABLE_KEY   # Clerk publishable key matching the same Clerk app as the server
CLERK_CALLBACK_SCHEME   # usually glide
CLERK_REDIRECT_URL      # usually glide://callback
```

Authentication depends on these being aligned with Clerk:

1. The macOS app uses `CLERK_PUBLISHABLE_KEY` to initialize ClerkKit.
2. OAuth redirects back to `CLERK_REDIRECT_URL` using `CLERK_CALLBACK_SCHEME`.
3. `Info.plist` registers the same URL scheme under `CFBundleURLTypes`.
4. The server validates requests with `CLERK_SECRET_KEY` from the same Clerk application.

For local development, point `GLIDE_SERVER_BASE_URL` at the Worker dev server:

```txt
GLIDE_SERVER_BASE_URL=http://localhost:8787
```

If `GLIDE_SERVER_BASE_URL` is unset, the app falls back to `http://localhost:8787`.

## Development

Install dependencies:

```bash
pnpm install
```

Run the Worker API:

```bash
pnpm run dev:server
```

Run all JS apps through Turborepo:

```bash
pnpm run dev
```

Open the macOS app from `apps/macos/Glide.xcodeproj` in Xcode and run the `Glide` scheme.

## Scripts

- `pnpm run dev` — start all configured apps in development mode
- `pnpm run build` — build the monorepo
- `pnpm run check-types` — TypeScript checks
- `pnpm run dev:server` — start the Cloudflare Worker locally
- `pnpm run deploy:server` — deploy the Worker
