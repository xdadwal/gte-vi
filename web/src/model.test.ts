import { it, expect } from "vitest";
import {
  alertFor,
  isOpen,
  openThrough,
  xy,
  type Incident,
  type Refuge,
} from "./model";
it("matches published metric-grid fixtures", () => {
  const p = xy(77.209, 28.6139);
  expect(Math.floor(p.x / 500)).toBe(1431);
  expect(Math.floor(p.y / 500)).toBe(6334);
});
it("escalation waits five minutes and rechecks after cooldown", () => {
  const i = {
      id: "i",
      cell: "0:0",
      status: "active",
      average: 2,
      buffer: 200,
    } as Incident,
    p = { id: "", x: 100, y: 100 };
  const first = alertFor(i, p, 500, 1000);
  expect(first.notify).toBe(true);
  const next = alertFor({ ...i, average: 3 }, p, 500, 2000, first.memory);
  expect(next.notify).toBe(false);
  expect(
    alertFor({ ...i, average: 3 }, p, 500, 301000, next.memory).notify,
  ).toBe(true);
});
it("opening exceptions use Delhi time", () => {
  const r = {
    closed: false,
    hours: { "0": [[0, 1440]] },
    exceptions: { "2026-10-11": [] },
  } as unknown as Refuge;
  expect(isOpen(r, Date.parse("2026-10-11T10:00:00Z"))).toBe(false);
});
it("reentry rearms after a minute but observes five-minute cooldown", () => {
  const i = {
      id: "i",
      cell: "0:0",
      status: "active",
      average: 2,
      buffer: 200,
    } as Incident,
    p = { id: "", x: 100, y: 100 },
    far = { id: "", x: 10000, y: 10000 };
  const first = alertFor(i, p, 500, 1000);
  const outside = alertFor(i, far, 500, 2000, first.memory);
  const rearm = alertFor(i, far, 500, 62000, outside.memory);
  const retry = alertFor(i, p, 500, 63000, rearm.memory);
  expect(retry.notify).toBe(false);
  expect(alertFor(i, p, 500, 301000, retry.memory).notify).toBe(true);
});
it("refuge opening must be continuous through ETA", () => {
  const r = {
    closed: false,
    hours: {
      "0": [
        [600, 605],
        [615, 660],
      ],
    },
    exceptions: {},
  } as unknown as Refuge;
  expect(
    openThrough(
      r,
      Date.parse("2026-10-11T10:00:00+05:30"),
      Date.parse("2026-10-11T10:20:00+05:30"),
    ),
  ).toBe(false);
});
it("an exact one-star decimal escalation is not lost to floating point rounding", () => {
  const i = {
      id: "i",
      cell: "0:0",
      status: "active",
      average: 4.1,
      buffer: 410,
    } as Incident,
    p = { id: "", x: 100, y: 100 };
  expect(
    alertFor(i, p, 500, 301000, { last: 1000, severity: 3.1, inside: true })
      .notify,
  ).toBe(true);
});
