type AssemblyTurnMessage = {
  type: string;
  transcript?: string;
  turn_order?: number;
  end_of_turn?: boolean;
  turn_is_formatted?: boolean;
};

type StoredTurnTranscript = {
  transcriptText: string;
  isFormatted: boolean;
};

export type AssemblyStreamState = {
  latestTranscriptText: string;
  activeTurnOrder: number | null;
  activeTurnTranscriptText: string;
  storedTurnTranscriptsByOrder: Map<number, StoredTurnTranscript>;
};

export function createAssemblyStreamState(): AssemblyStreamState {
  return {
    latestTranscriptText: "",
    activeTurnOrder: null,
    activeTurnTranscriptText: "",
    storedTurnTranscriptsByOrder: new Map()
  };
}

export function applyAssemblyTurnMessage(state: AssemblyStreamState, message: AssemblyTurnMessage): string {
  if (message.type.toLowerCase() !== "turn") {
    return state.latestTranscriptText;
  }

  const transcript = message.transcript?.trim() ?? "";
  const order = message.turn_order ?? state.activeTurnOrder ?? Math.max(-1, ...state.storedTurnTranscriptsByOrder.keys()) + 1;
  const isFinalForTurn = message.end_of_turn === true || message.turn_is_formatted === true;

  if (isFinalForTurn) {
    state.activeTurnOrder = null;
    state.activeTurnTranscriptText = "";
    if (transcript) {
      const existing = state.storedTurnTranscriptsByOrder.get(order);
      if (!(existing?.isFormatted && message.turn_is_formatted !== true)) {
        state.storedTurnTranscriptsByOrder.set(order, {
          transcriptText: transcript,
          isFormatted: message.turn_is_formatted === true
        });
      }
    }
  } else {
    state.activeTurnOrder = order;
    state.activeTurnTranscriptText = transcript;
  }

  const stored = Array.from(state.storedTurnTranscriptsByOrder.entries())
    .sort(([left], [right]) => left - right)
    .map(([, transcript]) => transcript.transcriptText)
    .filter(Boolean);
  const live = state.activeTurnTranscriptText ? [state.activeTurnTranscriptText] : [];
  state.latestTranscriptText = [...stored, ...live].join(" ").trim();
  return state.latestTranscriptText;
}

export class AssemblyAIStreamingTranscriptionController {
  constructor(private readonly serverUrl: string) {}

  async fetchTemporaryToken(): Promise<string> {
    const response = await fetch(`${this.serverUrl}/transcribe-token`, { method: "POST" });
    if (!response.ok) {
      throw new Error(`Failed to fetch AssemblyAI token (${response.status})`);
    }
    const body = (await response.json()) as { token?: unknown };
    if (typeof body.token !== "string" || body.token.length === 0) {
      throw new Error("Invalid token response from transcription proxy.");
    }
    return body.token;
  }
}

type StreamingDictationSessionOptions = {
  serverUrl: string;
  onTranscriptUpdate: (transcript: string) => void;
  onError: (error: Error) => void;
};

const TARGET_SAMPLE_RATE = 16000;
const BROWSER_AUDIO_CONTEXT_SAMPLE_RATE = 48000;

function createProcessedMicrophoneConstraints(): MediaStreamConstraints {
  // Borrowed from Recordly's browser mic path. Disabling AGC avoids Chrome
  // clamping quiet speech, while echo cancellation/noise suppression keep
  // dictation usable from the built-in Mac microphone.
  return {
    audio: {
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: false,
      channelCount: { ideal: 1 },
      sampleRate: { ideal: BROWSER_AUDIO_CONTEXT_SAMPLE_RATE }
    },
    video: false
  };
}

function downsampleToPcm16(input: Float32Array, inputSampleRate: number): ArrayBuffer {
  const ratio = inputSampleRate / TARGET_SAMPLE_RATE;
  const outputLength = Math.floor(input.length / ratio);
  const output = new Int16Array(outputLength);

  for (let index = 0; index < outputLength; index += 1) {
    const inputIndex = Math.floor(index * ratio);
    const sample = Math.max(-1, Math.min(1, input[inputIndex] ?? 0));
    output[index] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
  }

  return output.buffer;
}

function assemblyWebSocketUrl(token: string): string {
  const url = new URL("wss://streaming.assemblyai.com/v3/ws");
  url.searchParams.set("sample_rate", String(TARGET_SAMPLE_RATE));
  url.searchParams.set("encoding", "pcm_s16le");
  url.searchParams.set("format_turns", "true");
  url.searchParams.set("speech_model", "u3-rt-pro");
  url.searchParams.set("token", token);
  return url.toString();
}

export class BrowserAssemblyStreamingDictationSession {
  private readonly streamState = createAssemblyStreamState();
  private mediaStream: MediaStream | null = null;
  private audioContext: AudioContext | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private processorNode: ScriptProcessorNode | null = null;
  private websocket: WebSocket | null = null;
  private finalTranscript = "";
  private isStopping = false;
  private finalTranscriptResolver: ((transcript: string) => void) | null = null;
  private finalTranscriptTimer: number | null = null;

  constructor(private readonly options: StreamingDictationSessionOptions) {}

  async start(): Promise<void> {
    // Acquire microphone first, like Recordly, so permission/device failures are
    // surfaced before we open the realtime transcription socket.
    this.mediaStream = await navigator.mediaDevices.getUserMedia(createProcessedMicrophoneConstraints());

    const token = await new AssemblyAIStreamingTranscriptionController(this.options.serverUrl).fetchTemporaryToken();
    this.websocket = await this.openWebSocket(token);

    this.audioContext = new AudioContext({ sampleRate: BROWSER_AUDIO_CONTEXT_SAMPLE_RATE });
    if (this.audioContext.state === "suspended") {
      await this.audioContext.resume();
    }
    this.sourceNode = this.audioContext.createMediaStreamSource(this.mediaStream);
    this.processorNode = this.audioContext.createScriptProcessor(4096, 1, 1);
    this.processorNode.onaudioprocess = (event) => {
      if (!this.websocket || this.websocket.readyState !== WebSocket.OPEN || this.isStopping) {
        return;
      }
      const channelData = event.inputBuffer.getChannelData(0);
      this.websocket.send(downsampleToPcm16(channelData, this.audioContext?.sampleRate ?? event.inputBuffer.sampleRate));
    };
    this.sourceNode.connect(this.processorNode);
    const silentGain = this.audioContext.createGain();
    silentGain.gain.value = 0;
    this.processorNode.connect(silentGain);
    silentGain.connect(this.audioContext.destination);
  }

  async stop(): Promise<string> {
    this.isStopping = true;
    this.stopMicrophone();
    const transcript = await this.requestFinalTranscript();
    this.closeWebSocket();
    return transcript.trim();
  }

  cancel(): void {
    this.isStopping = true;
    this.stopMicrophone();
    this.closeWebSocket();
  }

  private async openWebSocket(token: string): Promise<WebSocket> {
    const websocket = new WebSocket(assemblyWebSocketUrl(token));
    websocket.binaryType = "arraybuffer";
    websocket.onmessage = (event) => {
      if (typeof event.data !== "string") {
        return;
      }
      try {
        const message = JSON.parse(event.data) as { type: string; transcript?: string; turn_order?: number; end_of_turn?: boolean; turn_is_formatted?: boolean; error?: string; message?: string };
        const messageType = message.type.toLowerCase();
        if (messageType === "error") {
          const error = new Error(message.error ?? message.message ?? "AssemblyAI transcription failed.");
          if (this.isStopping && this.finalTranscript.trim()) {
            this.deliverFinalTranscript(this.finalTranscript);
          } else {
            this.options.onError(error);
          }
          return;
        }
        if (messageType === "termination") {
          this.deliverFinalTranscript(this.finalTranscript);
          return;
        }
        if (messageType !== "turn") {
          return;
        }
        const transcript = applyAssemblyTurnMessage(this.streamState, message);
        this.finalTranscript = transcript;
        if (transcript) {
          this.options.onTranscriptUpdate(transcript);
        }
        if (this.isStopping && (message.end_of_turn === true || message.turn_is_formatted === true)) {
          this.deliverFinalTranscript(transcript);
        }
      } catch (error) {
        this.options.onError(error instanceof Error ? error : new Error(String(error)));
      }
    };

    await new Promise<void>((resolve, reject) => {
      websocket.onopen = () => resolve();
      websocket.onerror = () => reject(new Error("Failed to open AssemblyAI transcription websocket."));
    });
    websocket.onerror = () => {
      if (this.isStopping && this.finalTranscript.trim()) {
        this.deliverFinalTranscript(this.finalTranscript);
        return;
      }
      this.options.onError(new Error("AssemblyAI transcription websocket failed."));
    };
    websocket.onclose = () => {
      if (this.isStopping) {
        this.deliverFinalTranscript(this.finalTranscript);
      }
    };
    return websocket;
  }

  private requestFinalTranscript(): Promise<string> {
    const websocket = this.websocket;
    if (!websocket || websocket.readyState !== WebSocket.OPEN) {
      return Promise.resolve(this.finalTranscript);
    }

    websocket.send(JSON.stringify({ type: "ForceEndpoint" }));
    return new Promise((resolve) => {
      this.finalTranscriptResolver = resolve;
      this.finalTranscriptTimer = window.setTimeout(() => this.deliverFinalTranscript(this.finalTranscript), 1400);
    });
  }

  private deliverFinalTranscript(transcript: string): void {
    if (!this.finalTranscriptResolver) {
      return;
    }
    const resolver = this.finalTranscriptResolver;
    this.finalTranscriptResolver = null;
    if (this.finalTranscriptTimer !== null) {
      window.clearTimeout(this.finalTranscriptTimer);
      this.finalTranscriptTimer = null;
    }
    resolver(transcript.trim());
  }

  private stopMicrophone(): void {
    this.processorNode?.disconnect();
    this.processorNode = null;
    this.sourceNode?.disconnect();
    this.sourceNode = null;
    this.mediaStream?.getTracks().forEach((track) => track.stop());
    this.mediaStream = null;
    void this.audioContext?.close();
    this.audioContext = null;
  }

  private closeWebSocket(): void {
    if (this.finalTranscriptTimer !== null) {
      window.clearTimeout(this.finalTranscriptTimer);
      this.finalTranscriptTimer = null;
    }
    this.finalTranscriptResolver = null;
    if (this.websocket?.readyState === WebSocket.OPEN) {
      this.websocket.send(JSON.stringify({ type: "Terminate" }));
      this.websocket.close();
    }
    this.websocket = null;
  }
}
