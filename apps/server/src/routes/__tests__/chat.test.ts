import { describe, expect, it } from "vitest";
import { workersAiStreamToUIMessageSSE } from "../chat";

function encodeSSE(lines: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  const payload = lines.map((line) => `data: ${line}\n\n`).join("");
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(encoder.encode(payload));
      controller.close();
    },
  });
}

async function readAll(stream: ReadableStream<Uint8Array>): Promise<string> {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let out = "";
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    out += decoder.decode(value, { stream: true });
  }
  out += decoder.decode();
  return out;
}

function parseSSEFrames(body: string): Array<Record<string, unknown> | "[DONE]"> {
  return body
    .split("\n")
    .filter((line) => line.startsWith("data: "))
    .map((line) => {
      const data = line.slice("data: ".length);
      return data === "[DONE]" ? "[DONE]" : (JSON.parse(data) as Record<string, unknown>);
    });
}

describe("workersAiStreamToUIMessageSSE", () => {
  it("emits start/step/text frames and [DONE] in the order the Swift client parses", async () => {
    const source = encodeSSE([
      JSON.stringify({ response: "Hello" }),
      JSON.stringify({ response: ", world" }),
      "[DONE]",
    ]);

    const body = await readAll(workersAiStreamToUIMessageSSE(source));
    const frames = parseSSEFrames(body);

    expect(frames[0]).toEqual({ type: "start" });
    expect(frames[1]).toEqual({ type: "start-step" });
    expect(frames[2]).toEqual({ type: "text-start", id: "t" });
    expect(frames[3]).toEqual({ type: "text-delta", id: "t", delta: "Hello" });
    expect(frames[4]).toEqual({ type: "text-delta", id: "t", delta: ", world" });
    expect(frames[5]).toEqual({ type: "text-end", id: "t" });
    expect(frames[6]).toEqual({ type: "finish-step" });
    expect(frames[7]).toEqual({ type: "finish" });
    expect(frames[8]).toBe("[DONE]");
  });

  it("supports OpenAI-style choice deltas", async () => {
    const source = encodeSSE([
      JSON.stringify({ choices: [{ delta: { content: "hi" } }] }),
      JSON.stringify({ choices: [{ delta: { content: " there" } }] }),
      "[DONE]",
    ]);

    const body = await readAll(workersAiStreamToUIMessageSSE(source));
    const frames = parseSSEFrames(body);
    const deltas = frames
      .filter((f): f is Record<string, unknown> => f !== "[DONE]" && f.type === "text-delta")
      .map((f) => f.delta);
    expect(deltas).toEqual(["hi", " there"]);
  });

  it("emits well-formed frames even when the model stream is empty", async () => {
    const source = encodeSSE(["[DONE]"]);
    const body = await readAll(workersAiStreamToUIMessageSSE(source));
    const frames = parseSSEFrames(body);

    expect(frames[0]).toEqual({ type: "start" });
    expect(frames[frames.length - 1]).toBe("[DONE]");
    const types = frames.map((f) => (f === "[DONE]" ? "[DONE]" : f.type));
    expect(types).toEqual(["start", "start-step", "text-start", "text-end", "finish-step", "finish", "[DONE]"]);
  });

  it("treats a non-stream input as an empty completion", async () => {
    const body = await readAll(workersAiStreamToUIMessageSSE(undefined));
    const frames = parseSSEFrames(body);
    const types = frames.map((f) => (f === "[DONE]" ? "[DONE]" : f.type));
    expect(types).toEqual(["start", "start-step", "text-start", "text-end", "finish-step", "finish", "[DONE]"]);
  });

  it("skips malformed source lines without breaking the stream", async () => {
    const source = encodeSSE([
      "not-json",
      JSON.stringify({ response: "ok" }),
      "[DONE]",
    ]);
    const body = await readAll(workersAiStreamToUIMessageSSE(source));
    const frames = parseSSEFrames(body);
    const deltas = frames
      .filter((f): f is Record<string, unknown> => f !== "[DONE]" && f.type === "text-delta")
      .map((f) => f.delta);
    expect(deltas).toEqual(["ok"]);
  });
});
