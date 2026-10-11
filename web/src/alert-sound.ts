const ALERT_SECONDS = 12;
const PULSE_SECONDS = 0.5;
const PEAK_GAIN = 0.28;

export class AlertSound {
  private context?: AudioContext;
  private oscillator?: OscillatorNode;
  private gain?: GainNode;
  constructor(private createContext = () => new AudioContext()) {}

  // Call from a user gesture; keep one unlocked context for later alerts.
  unlock() {
    try {
      this.context ??= this.createContext();
      if (this.context.state === "suspended")
        void this.context.resume().catch(() => {});
    } catch {
      // Visual alerts remain available when audio is unsupported or blocked.
    }
  }

  play() {
    this.stop();
    const ctx = this.context;
    // Do not queue an old alert to play when a later gesture unlocks audio.
    if (!ctx || ctx.state !== "running") return;
    const oscillator = ctx.createOscillator();
    const gain = ctx.createGain();
    this.oscillator = oscillator;
    this.gain = gain;
    oscillator.connect(gain);
    gain.connect(ctx.destination);
    const start = ctx.currentTime;
    gain.gain.setValueAtTime(0, start);
    for (let elapsed = 0; elapsed < ALERT_SECONDS; elapsed += PULSE_SECONDS) {
      const time = start + elapsed;
      oscillator.frequency.setValueAtTime(elapsed % 1 === 0 ? 660 : 880, time);
      gain.gain.setValueAtTime(0, time);
      gain.gain.linearRampToValueAtTime(PEAK_GAIN, time + 0.025);
      gain.gain.setValueAtTime(PEAK_GAIN, time + 0.2);
      gain.gain.linearRampToValueAtTime(0, time + 0.3);
    }
    oscillator.onended = () => {
      oscillator.disconnect();
      gain.disconnect();
      if (this.oscillator === oscillator) {
        this.oscillator = undefined;
        this.gain = undefined;
      }
    };
    oscillator.start(start);
    oscillator.stop(start + ALERT_SECONDS);
  }

  stop() {
    const oscillator = this.oscillator;
    const gain = this.gain;
    if (!oscillator || !gain || !this.context) return;
    this.oscillator = undefined;
    this.gain = undefined;
    oscillator.onended = null;
    const now = this.context.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(0, now);
    try {
      oscillator.stop(now);
    } catch {
      // The scheduled sound may already have ended.
    }
    oscillator.disconnect();
    gain.disconnect();
  }

  dispose() {
    this.stop();
    if (this.context) void this.context.close().catch(() => {});
    this.context = undefined;
  }
}
