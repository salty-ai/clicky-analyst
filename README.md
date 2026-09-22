# Glide

Hi, this is Glide.

Built by [Shujan Shaikh](https://x.com/shujanshaikh).

Glide started as a clone of [Clicky](https://github.com/farzaa/clicky), a project by [Farza](https://x.com/FarzaTV). This repo takes that idea and turns it into a native macOS screen companion with authenticated cloud AI, speech, screen understanding, cursor pointing, and agent integrations for external apps like Notion, Google Docs, Gmail, Slack, GitHub, and more.

It's a buddy that lives on your Mac. You talk to it, it can see your screen, answer out loud, point at things, and help take action in the tools you connect.

## What it does

Glide is a macOS menu bar companion that you talk to with push-to-talk. It captures your screen, sends the visual context plus your transcript to an AI model, streams back an answer, speaks it out loud, and can point at UI elements with an on-screen cursor.

The backend runs as a Cloudflare Worker and handles the stuff you don't want shipped inside the app binary:

- authenticated chat streaming through the Cloudflare Workers AI binding (personal mode) or the Vercel AI SDK AI Gateway
- AssemblyAI realtime transcription token generation
- Gradium text-to-speech proxying
- Composio-powered agent integrations for connected apps like Notion, Google Docs, Gmail, Slack, GitHub, and more
- Shared-secret (`APP_AUTH_SECRET`) or Clerk authentication for the macOS app and server routes

## Architecture

Short version: Glide is a native Swift/AppKit menu bar app backed by a Hono Cloudflare Worker API.

The app handles the macOS experience: menu bar UI, push-to-talk, screen capture, voice playback, cursor pointing, and auth callbacks. The Worker handles authenticated API access, model streaming, transcription tokens, TTS proxying, and external-tool agent integrations.

## Project structure

```txt
apps/
  macos/    Native Swift/AppKit macOS app
  server/   Hono Cloudflare Worker API
packages/
  config/   Shared TypeScript config
```

## Agent integrations with Composio

Glide includes agent integrations through Composio. Users can connect external apps such as Notion, Google Docs, Gmail, Slack, GitHub, and other Composio-supported toolkits, then ask Glide to take action in those apps.

The server uses `@composio/core` with the Composio Vercel provider. When a signed-in user asks Glide to work with an external app, the server checks that user's active Composio connected accounts and loads the relevant toolkit tools into the AI SDK `streamText` call.

That means the AI agent only gets connected-app tools when the user explicitly asks for external-app work, like:

- creating a Notion page
- finding or summarizing a Google Doc
- drafting something in Gmail
- updating information in a connected workspace
- working with Slack, GitHub, or another connected toolkit

Integration endpoints:

- `POST /integrations/statuses` — check whether requested toolkits are connected
- `POST /integrations/:toolkit/connect` — create a Composio connection link
- `DELETE /integrations/:toolkit/disconnect` — remove connected accounts for a toolkit

Composio OAuth returns to the macOS app using:

```txt
glide://composio/callback
```

Make sure this callback/deep-link scheme is allowed wherever your Composio integration setup requires redirect URLs.

## Prerequisites

You'll want:

- macOS with Xcode installed
- Node.js / pnpm for the Worker and monorepo tooling
- A Cloudflare account for the Worker (with Workers AI enabled)
- A shared secret for `APP_AUTH_SECRET`; optionally API keys for AssemblyAI, Gradium, and Composio

## 1. Install dependencies

From the repo root:

```bash
pnpm install
```

## 2. Configure the Cloudflare Worker

The Worker lives in `apps/server`.

For local development, create `apps/server/.dev.vars`:

```bash
APP_AUTH_SECRET=...           # shared Bearer token the macOS app sends

# Optional integrations
ASSEMBLYAI_API_KEY=...
GRADIUM_API_KEY=...
COMPOSIO_API_KEY=...

# Optional; defaults are also in wrangler.toml
GRADIUM_TTS_MODEL=default
GRADIUM_TTS_VOICE_ID=YTpq7expH9539ERJ
```

For deployed Workers, add secrets with Wrangler:

```bash
cd apps/server
npx wrangler secret put APP_AUTH_SECRET
npx wrangler secret put ASSEMBLYAI_API_KEY   # optional
npx wrangler secret put GRADIUM_API_KEY      # optional
npx wrangler secret put COMPOSIO_API_KEY     # optional
```

Notes:

- `APP_AUTH_SECRET` authenticates all protected routes. The Worker fails closed (401) if it is unset.
- `ASSEMBLYAI_API_KEY` is used by `/transcribe-token`. When unset, the route returns 503 and the app falls back to the on-device Apple Speech provider.
- `GRADIUM_API_KEY` is used by `/tts`. When unset, the route returns 503.
- `COMPOSIO_API_KEY` enables connected-account lookup, toolkit auth links, and AI tools. App tools are unavailable on the personal Workers AI chat path — requests classified as needing them return 501.
- The chat model comes from the Workers AI `[ai]` binding declared in `apps/server/wrangler.toml` — no AI Gateway key needed.

## 3. Run the Worker locally

```bash
pnpm run dev:server
```

The local Worker usually runs at:

```txt
http://localhost:8787
```

For deployed Workers, use:

```bash
pnpm run deploy:server
```

## 4. Configure the macOS app

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

For local development, point the app at the Worker dev server:

```txt
GLIDE_SERVER_BASE_URL=http://localhost:8787
```

If `GLIDE_SERVER_BASE_URL` is unset, the app falls back to `http://localhost:8787`.

## 5. Open in Xcode and run

Open the macOS project:

```bash
open apps/macos/Glide.xcodeproj
```

In Xcode:

1. Select the `Glide` scheme.
2. Set your signing team under Signing & Capabilities.
3. Make sure the required build settings are present.
4. Hit Cmd + R.

Glide runs as a menu bar app. Click the menu bar icon, sign in, grant the permissions it asks for, and you're good.

## Development

Run all JS apps through Turborepo:

```bash
pnpm run dev
```

Run only the Worker API:

```bash
pnpm run dev:server
```

Open the macOS app from `apps/macos/Glide.xcodeproj` in Xcode and run the `Glide` scheme.

## Scripts

- `pnpm run dev` — start all configured apps in development mode
- `pnpm run build` — build the monorepo
- `pnpm run check-types` — TypeScript checks
- `pnpm run dev:server` — start the Cloudflare Worker locally
- `pnpm run deploy:server` — deploy the Worker

## Jev integration

The server can classify incoming chat requests with [Jev](https://typesafe.ai) through the TypeSafe direct API before building the model stream. This decides:

- whether to load Composio app integration tools (`useAppTools`)
- which connected toolkit the user is asking about (`toolkits`)
- whether the question is asking for analysis of visible screen content (`isAnalystQuestion`)
- how detailed the spoken answer should be (`answerVerbosity`)
- whether the request should be blocked (`gate`)

When analyst mode is triggered, the system prompt is extended with instructions to structure the answer as direct answer → evidence → implications, quote concrete visible details, and keep the response speakable.

Required environment variables:

```bash
JEV_API_KEY=...              # primary
# or
TYPESAFE_API_KEY=...         # alias
```

Both are read from `apps/server/.dev.vars` during local development or from Wranger secrets in production. If neither key is set, Jev is skipped and the classifier falls back to the existing regex helpers in `apps/server/src/chat/instructions.ts`.

A `gate=block` decision returns HTTP 400 `{ error: "blocked" }` without calling the model.

You can disable the Jev call entirely by leaving `JEV_API_KEY` and `TYPESAFE_API_KEY` unset.

## Personal deployment

Personal deployment mode runs the Worker entirely on infrastructure you already own — no Clerk, no Vercel AI Gateway, no external LLM API key required for the core chat loop.

### Authentication: `APP_AUTH_SECRET`

All protected routes accept a single shared Bearer token:

```bash
cd apps/server
npx wrangler secret put APP_AUTH_SECRET
```

The macOS app sends the same value as `Authorization: Bearer <token>` on every request. The server compares it in constant time against `env.APP_AUTH_SECRET` and fails closed (401) if the variable is unset. On success the request is scoped to `userId = "local"`, which is also the Composio entity key for any connected accounts.

### Model: Cloudflare Workers AI binding

`apps/server/wrangler.toml` declares:

```toml
[ai]
binding = "AI"
```

`/chat` calls `env.AI.run(model, { messages, stream: true, max_tokens })` directly and translates the Workers AI SSE stream into the AI SDK UI message stream format (`start` → `text-start` → `text-delta` → `text-end` → `finish`, then `data: [DONE]`) that the Swift client parses.

- Default model: `@cf/zai-org/glm-5.3`. Pass any other Workers AI model id in the request's `model` field to override.
- The Jev classifier still runs in front of the model (if configured) and the analyst/system instructions still shape the prompt — they only affect `messages`, not the transport.
- Composio app tools are **not** available in this mode: requests the classifier marks as `useAppTools` receive `501 { error: "tools unsupported with workers-ai model" }`.

### Optional services

- `ASSEMBLYAI_API_KEY` unset → `/transcribe-token` returns 503; use the on-device Apple Speech provider in the app.
- `GRADIUM_API_KEY` unset → `/tts` returns 503.
- `COMPOSIO_API_KEY` unset → `/integrations/*` returns 5xx and chat runs without app tools.

## Go crazy

Tweak the details, overhaul the design, or construct something uniquely yours
