import { describe, expect, it } from "vitest";
import { daysLabel, nextLabel, scheduleLabel } from "./jobs.ts";

describe("words for a job's schedule", () => {
  it("names days, intervals, windows and one-off moments", () => {
    expect(daysLabel([1, 2, 3, 4, 5])).toBe("weekdays");
    expect(daysLabel([0, 6])).toBe("weekends");
    expect(daysLabel([1, 3])).toBe("Mon Wed");
    expect(scheduleLabel({ time: "07:30", days: [1, 2, 3, 4, 5] })).toBe("07:30 · weekdays");
    expect(scheduleLabel({ time: "00:00", days: [0, 1, 2, 3, 4, 5, 6], every: 120, activeHours: { start: "08:00", end: "00:00" } })).toBe("every 2 h · 08:00–24:00");
    expect(scheduleLabel({ time: "00:00", days: [1, 2, 3, 4, 5], every: 30 })).toBe("every 30 min · weekdays");
    expect(scheduleLabel({ time: "00:00", days: [], at: new Date(2026, 10, 12, 18, 0).getTime() })).toMatch(/^once · .*18:00/);
  });

  it("says when a job runs next, or that it does not", () => {
    const now = new Date(2026, 10, 9, 10, 0).getTime();
    expect(nextLabel({ enabled: false, nextRun: now + 60000 }, now)).toBe("paused");
    expect(nextLabel({ enabled: true, nextRun: 0 }, now)).toBe("not scheduled");
    expect(nextLabel({ enabled: true, nextRun: now + 25 * 60000 }, now)).toBe("in 25 min");
    expect(nextLabel({ enabled: true, nextRun: now + 3 * 3600000 }, now)).toBe("in 3 h");
    expect(nextLabel({ enabled: true, nextRun: new Date(2026, 10, 10, 7, 30).getTime() }, now)).toBe("tomorrow 07:30");
  });
});
