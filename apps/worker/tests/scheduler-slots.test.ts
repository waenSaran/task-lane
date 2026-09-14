import assert from "node:assert/strict";
import test from "node:test";
import { latestDueScheduleSlot } from "../src/scheduler-slots.ts";

const config = { timezone: "Asia/Bangkok", fetchTimes: ["09:00", "14:00"] } as const;

test("09:00 Bangkok becomes the latest due slot just after 09:00", () => {
  const slot = latestDueScheduleSlot({ ...config, now: new Date("2026-09-14T02:00:05.000Z") });
  assert.equal(slot.slotKey, "2026-09-14|09:00|Asia/Bangkok");
  assert.equal(slot.scheduledAt.toISOString(), "2026-09-14T02:00:00.000Z");
});

test("14:00 Bangkok replaces 09:00 as the latest due slot", () => {
  const slot = latestDueScheduleSlot({ ...config, now: new Date("2026-09-14T07:00:05.000Z") });
  assert.equal(slot.slotKey, "2026-09-14|14:00|Asia/Bangkok");
  assert.equal(slot.scheduledAt.toISOString(), "2026-09-14T07:00:00.000Z");
});

test("before the first daily slot only the previous day's latest slot is due", () => {
  const slot = latestDueScheduleSlot({ ...config, now: new Date("2026-09-14T01:00:00.000Z") });
  assert.equal(slot.slotKey, "2026-09-13|14:00|Asia/Bangkok");
  assert.equal(slot.scheduledAt.toISOString(), "2026-09-13T07:00:00.000Z");
});

test("catch-up after both daily slots returns only today's 14:00 slot", () => {
  const slot = latestDueScheduleSlot({ ...config, now: new Date("2026-09-14T08:00:00.000Z") });
  assert.equal(slot.slotKey, "2026-09-14|14:00|Asia/Bangkok");
});
