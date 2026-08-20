import type { FastifyInstance } from 'fastify';
import type { JiraConfig } from '../jira-config.js';
import { refreshSprintReport } from '../sprint-report-service.js';
import type { SprintReport, SprintReportStore } from '../sprint-report-store.js';

export function registerSprintReportRoutes(
  app: FastifyInstance,
  store: SprintReportStore,
  jiraConfig: JiraConfig | undefined
): void {
  app.get('/sprint-reports/:sprintCode', async (request, reply) => {
    const { sprintCode } = request.params as { sprintCode: string };
    const report = await store.get(sprintCode);
    if (!report) {
      return reply.code(404).send({ error: 'Sprint report not found' });
    }
    return reply.send(report);
  });

  app.put('/sprint-reports/:sprintCode', async (request, reply) => {
    const { sprintCode } = request.params as { sprintCode: string };
    const body = request.body as SprintReport;
    const saved = await store.save({ ...body, sprintCode });
    return reply.send(saved);
  });

  app.post('/sprint-reports/:sprintCode/refresh', async (request, reply) => {
    const { sprintCode } = request.params as { sprintCode: string };
    const { startDate, endDate, labels } = (request.body ?? {}) as {
      startDate?: string;
      endDate?: string;
      labels?: string[];
    };
    if (!startDate || !endDate) {
      return reply.code(400).send({ error: 'startDate and endDate are required' });
    }
    if (!jiraConfig) {
      return reply.code(503).send({ error: 'Jira is not configured on this server' });
    }
    try {
      const report = await refreshSprintReport(jiraConfig, store, sprintCode, {
        startDate,
        endDate,
        labels: labels ?? [],
      });
      return reply.send(report);
    } catch (err) {
      return reply.code(502).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });
}
