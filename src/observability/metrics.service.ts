import { Injectable } from '@nestjs/common';

type RequestMetric = {
  count: number;
  durationSecondsSum: number;
};

@Injectable()
export class MetricsService {
  private readonly requests = new Map<string, RequestMetric>();

  observe(method: string, route: string, statusCode: number, durationSeconds: number) {
    const key = `${method}\u0000${route}\u0000${statusCode}`;
    const metric = this.requests.get(key) ?? { count: 0, durationSecondsSum: 0 };
    metric.count += 1;
    metric.durationSecondsSum += Math.max(0, durationSeconds);
    this.requests.set(key, metric);
  }

  renderPrometheus(nowMs = Date.now()): string {
    const lines = [
      '# HELP http_requests_total Total HTTP requests handled by this process.',
      '# TYPE http_requests_total counter',
    ];
    for (const [key, metric] of [...this.requests.entries()].sort(([left], [right]) => left.localeCompare(right))) {
      const [method, route, status] = key.split('\u0000');
      const labels = `method="${escapeLabel(method)}",route="${escapeLabel(route)}",status="${escapeLabel(status)}"`;
      lines.push(`http_requests_total{${labels}} ${metric.count}`);
    }
    lines.push('# HELP http_request_duration_seconds_sum Cumulative HTTP request duration in seconds.');
    lines.push('# TYPE http_request_duration_seconds_sum counter');
    for (const [key, metric] of [...this.requests.entries()].sort(([left], [right]) => left.localeCompare(right))) {
      const [method, route, status] = key.split('\u0000');
      const labels = `method="${escapeLabel(method)}",route="${escapeLabel(route)}",status="${escapeLabel(status)}"`;
      lines.push(`http_request_duration_seconds_sum{${labels}} ${metric.durationSecondsSum.toFixed(6)}`);
    }
    lines.push('# HELP http_request_duration_seconds_count Number of HTTP request duration observations.');
    lines.push('# TYPE http_request_duration_seconds_count counter');
    for (const [key, metric] of [...this.requests.entries()].sort(([left], [right]) => left.localeCompare(right))) {
      const [method, route, status] = key.split('\u0000');
      const labels = `method="${escapeLabel(method)}",route="${escapeLabel(route)}",status="${escapeLabel(status)}"`;
      lines.push(`http_request_duration_seconds_count{${labels}} ${metric.count}`);
    }
    const memory = process.memoryUsage();
    lines.push('# HELP process_uptime_seconds Process uptime in seconds.');
    lines.push('# TYPE process_uptime_seconds gauge');
    lines.push(`process_uptime_seconds ${process.uptime().toFixed(3)}`);
    lines.push('# HELP process_resident_memory_bytes Resident memory size in bytes.');
    lines.push('# TYPE process_resident_memory_bytes gauge');
    lines.push(`process_resident_memory_bytes ${memory.rss}`);
    lines.push('# HELP process_heap_used_bytes JavaScript heap used in bytes.');
    lines.push('# TYPE process_heap_used_bytes gauge');
    lines.push(`process_heap_used_bytes ${memory.heapUsed}`);
    lines.push('# HELP process_time_seconds Current Unix time in seconds.');
    lines.push('# TYPE process_time_seconds gauge');
    lines.push(`process_time_seconds ${(nowMs / 1000).toFixed(3)}`);
    return `${lines.join('\n')}\n`;
  }
}

function escapeLabel(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\n/g, '\\n').replace(/"/g, '\\"');
}

