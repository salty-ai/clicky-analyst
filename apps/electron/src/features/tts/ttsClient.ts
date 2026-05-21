export class BrowserTtsClient {
  private audio: HTMLAudioElement | null = null;
  private objectUrl: string | null = null;

  async speak(serverUrl: string, text: string): Promise<void> {
    this.stop();
    const trimmedText = text.trim();
    if (!trimmedText) {
      return;
    }

    const response = await fetch(`${serverUrl}/tts`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "audio/wav, audio/mpeg"
      },
      body: JSON.stringify({
        text: trimmedText,
        model_id: "eleven_flash_v2_5",
        voice_settings: {
          stability: 0.5,
          similarity_boost: 0.75
        }
      })
    });

    if (!response.ok) {
      throw new Error(`TTS failed (${response.status}): ${await response.text()}`);
    }

    const audioBlob = await response.blob();
    this.objectUrl = URL.createObjectURL(audioBlob);
    this.audio = new Audio(this.objectUrl);
    await new Promise<void>((resolve, reject) => {
      const audio = this.audio;
      if (!audio) {
        resolve();
        return;
      }
      audio.onended = () => resolve();
      audio.onerror = () => reject(new Error("Failed to play TTS audio."));
      void audio.play().catch(reject);
    });
  }

  stop(): void {
    if (this.audio) {
      this.audio.pause();
      this.audio.src = "";
      this.audio = null;
    }
    if (this.objectUrl) {
      URL.revokeObjectURL(this.objectUrl);
      this.objectUrl = null;
    }
  }
}
