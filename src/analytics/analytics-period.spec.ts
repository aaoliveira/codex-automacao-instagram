import { BadRequestException } from "@nestjs/common";
import { resolveAnalyticsPeriod, zonedDateKey } from "./analytics-period";

describe("analytics calendar periods", () => {
  it("uses local-day boundaries across daylight-saving changes", () => {
    const period = resolveAnalyticsPeriod(
      "2026-03-08",
      "2026-03-08",
      "America/New_York",
    );
    expect(period.numberOfDays).toBe(1);
    expect(period.endExclusive.getTime() - period.start.getTime()).toBe(
      23 * 60 * 60 * 1000,
    );
    expect(
      zonedDateKey(new Date("2026-03-09T03:30:00.000Z"), "America/New_York"),
    ).toBe("2026-03-08");
  });

  it("rejects reversed, invalid, excessive and unknown timezone periods", () => {
    expect(() =>
      resolveAnalyticsPeriod("2026-02-30", "2026-03-01", "UTC"),
    ).toThrow(BadRequestException);
    expect(() =>
      resolveAnalyticsPeriod("2026-03-02", "2026-03-01", "UTC"),
    ).toThrow(BadRequestException);
    expect(() =>
      resolveAnalyticsPeriod("2025-01-01", "2026-01-02", "UTC"),
    ).toThrow(BadRequestException);
    expect(() =>
      resolveAnalyticsPeriod("2026-03-01", "2026-03-01", "Mars/Olympus"),
    ).toThrow(BadRequestException);
  });
});
