import { expect, it, vi } from "vitest";
import { AlertSound } from "./alert-sound";
function fixture(state = "running") {
  const oscillator = {
    frequency: { setValueAtTime: vi.fn() },
    connect: vi.fn(),
    disconnect: vi.fn(),
    start: vi.fn(),
    stop: vi.fn(),
    onended: null as (() => void) | null,
  };
  const gain = {
    gain: {
      setValueAtTime: vi.fn(),
      linearRampToValueAtTime: vi.fn(),
      cancelScheduledValues: vi.fn(),
    },
    connect: vi.fn(),
    disconnect: vi.fn(),
  };
  const context = {
    currentTime: 10,
    state,
    destination: {},
    resume: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    createOscillator: vi.fn(() => oscillator),
    createGain: vi.fn(() => gain),
  };
  return {
    sound: new AlertSound(() => context as unknown as AudioContext),
    context,
    oscillator,
    gain,
  };
}
it("plays a louder pulsing alert for twelve seconds", () => {
  const { sound, oscillator, gain } = fixture();
  sound.unlock();
  sound.play();
  expect(oscillator.start).toHaveBeenCalledWith(10);
  expect(oscillator.stop).toHaveBeenCalledWith(22);
  expect(
    gain.gain.linearRampToValueAtTime.mock.calls.some(
      ([value]) => value >= 0.28,
    ),
  ).toBe(true);
});
it("acknowledgement immediately silences and disconnects the active sound", () => {
  const { sound, oscillator, gain, context } = fixture();
  sound.unlock();
  sound.play();
  context.currentTime = 11;
  sound.stop();
  sound.stop();
  expect(oscillator.stop.mock.calls).toEqual([[22], [11]]);
  expect(gain.gain.cancelScheduledValues).toHaveBeenCalledWith(11);
  expect(gain.gain.setValueAtTime).toHaveBeenLastCalledWith(0, 11);
  expect(oscillator.disconnect).toHaveBeenCalledTimes(1);
});
it("never queues a stale alert behind browser autoplay restrictions", () => {
  const { sound, oscillator } = fixture("suspended");
  sound.unlock();
  sound.play();
  expect(oscillator.start).not.toHaveBeenCalled();
});
it("replaces an active sound and releases its audio context on disposal", () => {
  const { sound, oscillator, context } = fixture();
  sound.unlock();
  sound.play();
  sound.play();
  sound.dispose();
  expect(oscillator.start).toHaveBeenCalledTimes(2);
  expect(context.close).toHaveBeenCalledTimes(1);
});

it("disconnects naturally completed sound without a second stop", () => {
  const { sound, oscillator, gain } = fixture();
  sound.unlock();
  sound.play();
  oscillator.onended?.();
  sound.stop();
  expect(oscillator.disconnect).toHaveBeenCalledTimes(1);
  expect(gain.disconnect).toHaveBeenCalledTimes(1);
  expect(oscillator.stop).toHaveBeenCalledTimes(1);
});
