import {
  shouldUseAppIntegrationTools,
  appToolkitsMentionedInRequest,
} from "../chat/instructions";
import { summarizeForLog } from "../utils/logging";

export type ChatIntent = {
  useAppTools: boolean;
  toolkits: string[];
  isAnalystQuestion: boolean;
  answerVerbosity: "brief" | "normal" | "deep";
  gate: "allow" | "block";
};

type ChoiceQuestion = {
  type: "choice";
  instructions: string;
  criteria: Record<string, string>;
};

type Question = ChoiceQuestion;

const SUPPORTED_TOOLKITS = [
  "notion",
  "googlecalendar",
  "googledocs",
  "googledrive",
  "googlesheets",
  "googleslides",
] as const;

const FALLBACK_INTENT: ChatIntent = {
  useAppTools: false,
  toolkits: [],
  isAnalystQuestion: false,
  answerVerbosity: "normal",
  gate: "allow",
};

function buildQuestions(): Record<string, Question> {
  return {
    appTools: {
      type: "choice",
      instructions:
        "Does the user ask to create, edit, search, send, schedule, or organize content in an external connected app? External connected apps include Notion, Gmail, Slack, GitHub, Google Docs, Google Sheets, Google Slides, Google Drive, Calendar, etc.",
      criteria: {
        yes: "The user explicitly asks to create/edit/search/send/schedule/organize content in an external connected app like Notion, Gmail, Slack, GitHub, Docs, Sheets, Slides, Drive, or Calendar.",
        no: "The user is asking about screen pointing, cursor coordinates, navigation, visual UI help, or general chat, or does not ask to act inside an external connected app.",
      },
    },
    toolkits: {
      type: "choice",
      instructions:
        "Which supported connected toolkit, if any, is explicitly mentioned or implied by the user's request? Supported toolkits: Notion, Google Calendar, Google Docs, Google Drive, Google Sheets, Google Slides.",
      criteria: {
        notion: "The user mentions Notion or asks to act inside Notion.",
        googlecalendar:
          "The user mentions Google Calendar, Calendar events, or scheduling through Google Calendar.",
        googledocs:
          "The user mentions Google Docs, Docs, or Google Documents.",
        googledrive:
          "The user mentions Google Drive, Drive, or Google Drive files/folders.",
        googlesheets:
          "The user mentions Google Sheets, Sheets, or spreadsheets.",
        googleslides:
          "The user mentions Google Slides, Slides, or presentations.",
      },
    },
    analyst: {
      type: "choice",
      instructions:
        "Does the user ask to analyze, interpret, evaluate, compare, summarize, extract insights from, or review figures, tables, data, code, or any visible screen content?",
      criteria: {
        yes: "The user asks to analyze, interpret, evaluate, compare, summarize, extract insights, or review figures/tables/data/code/numbers/charts/visible screen content.",
        no: "The user is making a simple lookup, asking a navigation question, asking how to click, or the request is not about analysis of visible content.",
      },
    },
    verbosity: {
      type: "choice",
      instructions:
        "How detailed should the spoken answer be? Pick brief for one-liners, normal for balanced, deep when the user asks for thorough explanation with evidence and implications.",
      criteria: {
        brief: "The user asks for a quick one-liner, a short yes/no, or a very terse answer.",
        normal: "The user asks a normal question that deserves a balanced answer without deep analysis.",
        deep: "The user asks for detailed explanation, thorough analysis, step-by-step reasoning, implications, or recommendations with evidence.",
      },
    },
    safety: {
      type: "choice",
      instructions:
        "Should this chat request be blocked? Block spam, NSFW, hateful, or requests to perform clearly unsafe actions.",
      criteria: {
        allow: "The request is a normal, safe user question.",
        block:
          "The request is spam, NSFW, hateful, or asks the assistant to perform a clearly unsafe action.",
      },
    },
  };
}

function buildRequest(apiKey: string, latestUserText: string) {
  return {
    url: "https://api.typesafe.ai/v1/systemone",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: {
      model: "jev-latest",
      state: { latestUserText },
      questions: buildQuestions(),
    },
  };
}

function parseChoice(
  answers: Record<string, unknown>,
  id: string,
  allowed: readonly string[]
): string | undefined {
  const answer = answers[id];
  if (!answer || typeof answer !== "object") {
    return undefined;
  }
  const choice = (answer as Record<string, unknown>).choice;
  if (typeof choice !== "string") {
    return undefined;
  }
  return allowed.includes(choice) ? choice : undefined;
}

function parseIntent(json: unknown): ChatIntent | undefined {
  if (!json || typeof json !== "object") {
    return undefined;
  }
  const answers = ((json as Record<string, unknown>).answers ?? {}) as Record<string, unknown>;

  const useAppToolsRaw = parseChoice(answers, "appTools", ["yes", "no"]);
  const toolkit = parseChoice(answers, "toolkits", SUPPORTED_TOOLKITS);
  const analystRaw = parseChoice(answers, "analyst", ["yes", "no"]);
  const verbosity = parseChoice(answers, "verbosity", ["brief", "normal", "deep"]);
  const gate = parseChoice(answers, "safety", ["allow", "block"]);

  if (
    useAppToolsRaw === undefined ||
    analystRaw === undefined ||
    verbosity === undefined ||
    gate === undefined
  ) {
    return undefined;
  }

  return {
    useAppTools: useAppToolsRaw === "yes",
    toolkits: toolkit ? [toolkit] : [],
    isAnalystQuestion: analystRaw === "yes",
    answerVerbosity: verbosity as "brief" | "normal" | "deep",
    gate: gate as "allow" | "block",
  };
}

function regexFallback(latestUserText: string): ChatIntent {
  return {
    useAppTools: shouldUseAppIntegrationTools(latestUserText),
    toolkits: appToolkitsMentionedInRequest(latestUserText),
    isAnalystQuestion: false,
    answerVerbosity: "normal",
    gate: "allow",
  };
}

export function jevApiKey(env: { JEV_API_KEY?: string; TYPESAFE_API_KEY?: string }): string | undefined {
  return env.JEV_API_KEY?.trim() || env.TYPESAFE_API_KEY?.trim() || undefined;
}

export async function classifyRequest(
  env: { JEV_API_KEY?: string; TYPESAFE_API_KEY?: string },
  latestUserText: string | undefined,
  fetcher: typeof fetch = fetch
): Promise<ChatIntent> {
  if (!latestUserText) {
    return FALLBACK_INTENT;
  }

  const apiKey = jevApiKey(env);
  if (!apiKey) {
    return regexFallback(latestUserText);
  }

  const request = buildRequest(apiKey, latestUserText);

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 2000);

    const response = await fetcher(request.url, {
      method: "POST",
      headers: request.headers,
      body: JSON.stringify(request.body),
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      console.warn("Jev classifier returned non-OK response", response.status);
      return regexFallback(latestUserText);
    }

    const json: unknown = await response.json();
    const intent = parseIntent(json);
    if (!intent) {
      console.warn("Jev classifier returned unparseable intent", summarizeForLog(json));
      return regexFallback(latestUserText);
    }

    return intent;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn("Jev classifier failed, falling back to regex", message);
    return regexFallback(latestUserText);
  }
}
