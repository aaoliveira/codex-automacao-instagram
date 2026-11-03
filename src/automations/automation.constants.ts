export const INSTAGRAM_AUTOMATION_QUEUE = "instagram-automations";
export const INSTAGRAM_AUTOMATION_JOB = "process-event-rules";

export const MAX_AUTOMATION_RULE_EXECUTIONS_PER_EVENT = 25;
export const MAX_AUTOMATION_ACTIONS_PER_RULE = 10;
export const MESSAGE_RESPONSE_WINDOW_MS = 24 * 60 * 60 * 1_000;

export const AUTOMATION_PROVIDER = Symbol("AUTOMATION_PROVIDER");
