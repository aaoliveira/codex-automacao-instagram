import { Processor, WorkerHost } from "@nestjs/bullmq";
import { Injectable } from "@nestjs/common";
import { Job } from "bullmq";
import {
  PUBLICATION_ANALYTICS_QUEUE,
  PUBLICATION_ANALYTICS_SYNC_JOB,
} from "./analytics.constants";
import { AnalyticsService, AnalyticsSyncJobData } from "./analytics.service";
import { ANALYTICS_WORKER_CONCURRENCY } from "../shared/queue-runtime-config";

@Injectable()
@Processor(PUBLICATION_ANALYTICS_QUEUE, {
  concurrency: ANALYTICS_WORKER_CONCURRENCY,
  lockDuration: 600_000,
})
export class AnalyticsProcessor extends WorkerHost {
  constructor(private readonly analytics: AnalyticsService) {
    super();
  }

  async process(job: Job<AnalyticsSyncJobData>): Promise<void> {
    if (job.name !== PUBLICATION_ANALYTICS_SYNC_JOB) return;
    await this.analytics.processSyncRun(
      job.data.organizationId,
      job.data.syncRunId,
      job.attemptsMade,
      Number(job.opts.attempts ?? 1),
      job,
    );
  }
}
