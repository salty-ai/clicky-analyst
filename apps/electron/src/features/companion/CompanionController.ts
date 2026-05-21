import { parsePointTags, stripPointTags, type PointTag } from "./pointTags";
import { COMPANION_SYSTEM_PROMPT } from "./prompts";

export type CompanionChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export type CompanionControllerOptions = {
  serverUrl: string;
  model: string;
  onTextChunk?: (text: string) => void;
};

export type CompanionResponse = {
  text: string;
  displayText: string;
  pointTags: PointTag[];
};

export class CompanionController {
  private readonly conversation: CompanionChatMessage[] = [];

  constructor(private options: CompanionControllerOptions) {}

  updateOptions(options: Partial<CompanionControllerOptions>) {
    this.options = { ...this.options, ...options };
  }

  getHistory(): CompanionChatMessage[] {
    return [...this.conversation];
  }

  async sendPrompt(userPrompt: string, images: Array<{ data: string; label: string }> = []): Promise<CompanionResponse> {
    const response = await fetch(`${this.options.serverUrl}/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: this.options.model,
        stream: true,
        system: COMPANION_SYSTEM_PROMPT,
        messages: [
          ...this.conversation,
          {
            role: "user",
            content: [
              ...images.map((image) => ({ type: "image", source: image })),
              { type: "text", text: userPrompt }
            ]
          }
        ]
      })
    });

    if (!response.ok) {
      throw new Error(`Companion chat failed (${response.status})`);
    }

    const text = await response.text();
    this.options.onTextChunk?.(text);
    this.remember(userPrompt, text);
    return {
      text,
      displayText: stripPointTags(text),
      pointTags: parsePointTags(text)
    };
  }

  private remember(userPrompt: string, assistantResponse: string) {
    this.conversation.push({ role: "user", content: userPrompt });
    this.conversation.push({ role: "assistant", content: assistantResponse });
    while (this.conversation.length > 20) {
      this.conversation.shift();
    }
  }
}
