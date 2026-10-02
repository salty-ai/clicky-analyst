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

type SupportedToolkit = (typeof SUPPORTED_TOOLKITS)[number];

const TOOLKIT_LABELS: Record<SupportedToolkit, string> = {
  notion: "Notion",
  googlecalendar: "Google Calendar",
  googledocs: "Google Docs",
  googledrive: "Google Drive",
  googlesheets: "Google Sheets",
  googleslides: "Google Slides",
};

const TOOLKIT_QUESTION_ID_PREFIX = "toolkit_";
const STATE_SUMMARY_MAX_LENGTH = 280;

const FALLBACK_INTENT: ChatIntent = {
  useAppTools: false,
  toolkits: [],
  isAnalystQuestion: false,
  answerVerbosity: "normal",
  gate: "allow",
};

function toolkitQuestion(toolkit: SupportedToolkit): ChoiceQuestion {
  const label = TOOLKIT_LABELS[toolkit];
  return {
    type: "choice",
    instructions: `Does the user explicitly mention or clearly imply ${label}? Answer yes only when the request should act inside ${label}.`,
    criteria: {
      yes: `The user mentions ${label} by name, or clearly asks to read, create, edit, search, send, schedule, or organize content inside ${label}.`,
      no: `The user does not mention ${label} and the request does not require acting inside ${label}.`,
    },
  };
}

function buildQuestions(): Record<string, Question> {
  const toolkitQuestions = Object.fromEntries(
    SUPPORTED_TOOLKITS.map((toolkit) => [
      `${TOOLKIT_QUESTION_ID_PREFIX}${toolkit}`,
      toolkitQuestion(toolkit),
    ])
  );

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
    ...toolkitQuestions,
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

function truncateSummary(text: string): string {
  const collapsed = text.replace(/\s+/g, " ").trim();
  if (collapsed.length <= STATE_SUMMARY_MAX_LENGTH) {
    return collapsed;
  }
  return `${collapsed.slice(0, STATE_SUMMARY_MAX_LENGTH - 1)}…`;
}

function buildRequest(
  apiKey: string,
  latestUserText: string,
  previousExchangeSummary?: string
) {
  const state: Record<string, string> = { latestUserText };
  if (previousExchangeSummary) {
    const summary = truncateSummary(previousExchangeSummary);
    if (summary) {
      state.previousExchangeSummary = summary;
    }
  }
  return {
    url: "https://api.typesafe.ai/v1/systemone",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: {
      model: "jev-latest",
      state,
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

function parseToolkits(answers: Record<string, unknown>): string[] {
  const toolkits: string[] = [];
  for (const toolkit of SUPPORTED_TOOLKITS) {
    const choice = parseChoice(answers, `${TOOLKIT_QUESTION_ID_PREFIX}${toolkit}`, [
      "yes",
      "no",
    ]);
    if (choice === "yes") {
      toolkits.push(toolkit);
    }
  }
  return toolkits;
}

function parseIntent(json: unknown): ChatIntent | undefined {
  if (!json || typeof json !== "object") {
    return undefined;
  }
  const answers = ((json as Record<string, unknown>).answers ?? {}) as Record<string, unknown>;

  const useAppToolsRaw = parseChoice(answers, "appTools", ["yes", "no"]);
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
    toolkits: parseToolkits(answers),
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
  fetcher: typeof fetch = fetch,
  options: { previousExchangeSummary?: string } = {}
): Promise<ChatIntent> {
  if (!latestUserText) {
    return FALLBACK_INTENT;
  }

  const apiKey = jevApiKey(env);
  if (!apiKey) {
    return regexFallback(latestUserText);
  }

  const request = buildRequest(apiKey, latestUserText, options.previousExchangeSummary);

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
