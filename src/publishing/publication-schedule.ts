import { BadRequestException } from "@nestjs/common";

const RFC3339_WITH_OFFSET =
  /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?(?:Z|[+-](?:[01]\d|2[0-3]):[0-5]\d)$/;

export interface ResolvedPublicationSchedule {
  scheduledAt: Date;
  timezone: string;
  delayMs: number;
}

export function resolvePublicationSchedule(
  scheduledAtInput: string,
  timezoneInput: string,
  now = new Date(),
  requireFuture = true,
): ResolvedPublicationSchedule {
  if (!RFC3339_WITH_OFFSET.test(scheduledAtInput)) {
    throw new BadRequestException(
      "scheduledAt must be an RFC 3339 timestamp with an explicit UTC offset",
    );
  }
  const scheduledAt = new Date(scheduledAtInput);
  if (!Number.isFinite(scheduledAt.getTime())) {
    throw new BadRequestException("scheduledAt is not a valid date and time");
  }
  if (requireFuture && scheduledAt.getTime() <= now.getTime()) {
    throw new BadRequestException("scheduledAt must be in the future");
  }

  const timezone = timezoneInput.trim();
  if (!timezone) throw new BadRequestException("timezone is required");
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: timezone }).format(scheduledAt);
  } catch {
    throw new BadRequestException("timezone must be a valid IANA timezone");
  }

  return {
    scheduledAt,
    timezone,
    delayMs: Math.max(0, scheduledAt.getTime() - now.getTime()),
  };
}
