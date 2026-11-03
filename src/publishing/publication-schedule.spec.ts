import { resolvePublicationSchedule } from "./publication-schedule";

describe("resolvePublicationSchedule", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-11-03T12:00:00.000Z"));
  });

  afterEach(() => jest.useRealTimers());

  it("resolves a future RFC 3339 instant and IANA timezone deterministically", () => {
    expect(
      resolvePublicationSchedule(
        "2026-11-03T09:01:30-03:00",
        "America/Bahia",
      ),
    ).toEqual({
      scheduledAt: new Date("2026-11-03T12:01:30.000Z"),
      timezone: "America/Bahia",
      delayMs: 90_000,
    });
  });

  it("rejects local timestamps without an offset and invalid timezones", () => {
    expect(() =>
      resolvePublicationSchedule("2026-11-03T12:30:00", "UTC"),
    ).toThrow("explicit UTC offset");
    expect(() =>
      resolvePublicationSchedule("2026-11-03T12:30:00Z", "Invalid/Zone"),
    ).toThrow("valid IANA timezone");
  });

  it("rejects a schedule that is no longer in the future", () => {
    expect(() =>
      resolvePublicationSchedule("2026-11-03T12:00:00Z", "UTC"),
    ).toThrow("must be in the future");
  });
});
