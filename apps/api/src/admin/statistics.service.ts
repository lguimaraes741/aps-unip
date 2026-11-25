import { BadRequestException, Injectable } from '@nestjs/common';
import { OccurrenceStatus, Prisma, Severity } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ExportQuery, PeriodQuery } from './admin.dto';

/** Dias e horários são contados no fuso da cidade (o servidor e o banco trabalham em UTC). */
export const REPORT_TZ = 'America/Sao_Paulo';
const MAX_PERIOD_DAYS = 366;
const MAX_EXPORT_ROWS = 50_000;

const STATUSES: OccurrenceStatus[] = ['PENDING', 'UNDER_REVIEW', 'VALIDATED', 'REJECTED', 'RESOLVED'];
const SEVERITIES: Severity[] = ['LOW', 'MODERATE', 'HIGH', 'CRITICAL'];
const STATUS_LABEL: Record<OccurrenceStatus, string> = {
  PENDING: 'Pendente',
  UNDER_REVIEW: 'Em análise',
  VALIDATED: 'Validada',
  REJECTED: 'Rejeitada',
  RESOLVED: 'Resolvida',
};
const SEVERITY_LABEL: Record<Severity, string> = { LOW: 'Baixa', MODERATE: 'Moderada', HIGH: 'Alta', CRITICAL: 'Crítica' };

const zeroBy = <K extends string>(keys: K[]) => Object.fromEntries(keys.map((k) => [k, 0])) as Record<K, number>;

/**
 * Célula de CSV segura: aspas escapadas e proteção contra injeção de fórmulas
 * (=, +, -, @, tab, CR no início fariam o Excel executar a célula como fórmula).
 */
export function csvCell(value: unknown): string {
  if (value === null || value === undefined) return '';
  let text = value instanceof Date ? value.toISOString() : String(value);
  // Um número puro (ex.: latitude "-23.550520") é seguro e precisa continuar sendo número na planilha.
  const plainNumber = /^[+-]?\d+(\.\d+)?$/.test(text);
  if (!plainNumber && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[";\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

@Injectable()
export class StatisticsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Visão geral do painel. Registros de demonstração são contados à parte (`demo`). */
  async dashboard() {
    const now = new Date();
    const dayAgo = new Date(now.getTime() - 24 * 3600_000);
    const twoDaysAgo = new Date(now.getTime() - 48 * 3600_000);
    const monthAgo = new Date(now.getTime() - 30 * 24 * 3600_000);
    const base = { deletedAt: null } satisfies Prisma.OccurrenceWhereInput;

    const [byStatus, bySeverity, last24h, previous24h, openReports, demo, [avg], daily, neighborhoods] = await Promise.all([
      this.prisma.occurrence.groupBy({ by: ['status'], where: base, _count: { _all: true } }),
      this.prisma.occurrence.groupBy({
        by: ['severity'],
        where: { ...base, status: { in: ['PENDING', 'UNDER_REVIEW', 'VALIDATED'] } },
        _count: { _all: true },
      }),
      this.prisma.occurrence.count({ where: { ...base, createdAt: { gte: dayAgo } } }),
      this.prisma.occurrence.count({ where: { ...base, createdAt: { gte: twoDaysAgo, lt: dayAgo } } }),
      this.prisma.contentReport.count({ where: { status: 'OPEN', occurrence: { deletedAt: null } } }),
      this.prisma.occurrence.count({ where: { ...base, isDemo: true } }),
      this.prisma.$queryRaw<{ minutes: number | null }[]>`
        SELECT ROUND(AVG(EXTRACT(EPOCH FROM (validated_at - created_at)) / 60))::int AS minutes
        FROM occurrences WHERE deleted_at IS NULL AND validated_at IS NOT NULL AND validated_at >= ${monthAgo}`,
      // Últimos 14 dias (inclui hoje), no fuso da cidade; dias sem registros aparecem com zero.
      this.prisma.$queryRaw<{ day: string; created: number; resolved: number }[]>`
        WITH days AS (
          SELECT generate_series((now() AT TIME ZONE ${REPORT_TZ})::date - 13, (now() AT TIME ZONE ${REPORT_TZ})::date, '1 day')::date AS day
        )
        SELECT to_char(d.day, 'YYYY-MM-DD') AS day,
          (SELECT count(*) FROM occurrences o WHERE o.deleted_at IS NULL AND (o.created_at AT TIME ZONE ${REPORT_TZ})::date = d.day)::int AS created,
          (SELECT count(*) FROM occurrences o WHERE o.deleted_at IS NULL AND (o.resolved_at AT TIME ZONE ${REPORT_TZ})::date = d.day)::int AS resolved
        FROM days d ORDER BY d.day`,
      this.prisma.$queryRaw<{ neighborhood: string; total: number }[]>`
        SELECT COALESCE(NULLIF(btrim(neighborhood), ''), 'Não informado') AS neighborhood, count(*)::int AS total
        FROM occurrences WHERE deleted_at IS NULL AND created_at >= ${monthAgo}
        GROUP BY 1 ORDER BY total DESC, neighborhood LIMIT 5`,
    ]);

    const status = zeroBy(STATUSES);
    byStatus.forEach((g) => (status[g.status] = g._count._all));
    const severity = zeroBy(SEVERITIES);
    bySeverity.forEach((g) => (severity[g.severity] = g._count._all));
    return {
      status,
      activeBySeverity: severity,
      moderationQueue: status.PENDING + status.UNDER_REVIEW,
      openReports,
      last24h,
      previous24h,
      avgValidationMinutes30d: avg?.minutes ?? null,
      daily,
      topNeighborhoods30d: neighborhoods,
      demo,
      generatedAt: now.toISOString(),
    };
  }

  /** Relatório de um período [from, to). Contagens feitas no banco, conferidas por testes com SQL. */
  async statistics({ from, to }: PeriodQuery) {
    this.checkPeriod(from, to);
    const where = Prisma.sql`deleted_at IS NULL AND created_at >= ${from} AND created_at < ${to}`;
    const [[totals], byStatusRows, bySeverityRows, byNeighborhood, byDay] = await Promise.all([
      this.prisma.$queryRaw<{ total: number; demo: number; resolved: number; validated: number; avg_validation_minutes: number | null }[]>`
        SELECT count(*)::int AS total,
          count(*) FILTER (WHERE is_demo)::int AS demo,
          count(*) FILTER (WHERE status = 'RESOLVED')::int AS resolved,
          count(*) FILTER (WHERE validated_at IS NOT NULL)::int AS validated,
          ROUND(AVG(EXTRACT(EPOCH FROM (validated_at - created_at)) / 60))::int AS avg_validation_minutes
        FROM occurrences WHERE ${where}`,
      this.prisma.$queryRaw<{ status: OccurrenceStatus; total: number }[]>`
        SELECT status::text AS status, count(*)::int AS total FROM occurrences WHERE ${where} GROUP BY status`,
      this.prisma.$queryRaw<{ severity: Severity; total: number }[]>`
        SELECT severity::text AS severity, count(*)::int AS total FROM occurrences WHERE ${where} GROUP BY severity`,
      this.prisma.$queryRaw<{ neighborhood: string; total: number; critical: number; high: number; resolved: number }[]>`
        SELECT COALESCE(NULLIF(btrim(neighborhood), ''), 'Não informado') AS neighborhood,
          count(*)::int AS total,
          count(*) FILTER (WHERE severity = 'CRITICAL')::int AS critical,
          count(*) FILTER (WHERE severity = 'HIGH')::int AS high,
          count(*) FILTER (WHERE status = 'RESOLVED')::int AS resolved
        FROM occurrences WHERE ${where}
        GROUP BY 1 ORDER BY total DESC, neighborhood`,
      this.prisma.$queryRaw<{ day: string; total: number }[]>`
        SELECT to_char((created_at AT TIME ZONE ${REPORT_TZ})::date, 'YYYY-MM-DD') AS day, count(*)::int AS total
        FROM occurrences WHERE ${where} GROUP BY 1 ORDER BY 1`,
    ]);
    const byStatus = zeroBy(STATUSES);
    byStatusRows.forEach((r) => (byStatus[r.status] = r.total));
    const bySeverity = zeroBy(SEVERITIES);
    bySeverityRows.forEach((r) => (bySeverity[r.severity] = r.total));
    return {
      period: { from: from.toISOString(), to: to.toISOString(), timezone: REPORT_TZ },
      total: totals.total,
      demo: totals.demo,
      byStatus,
      bySeverity,
      /** Resolvidas ÷ validadas no período (null sem validações). */
      resolutionRate: totals.validated > 0 ? Math.round((totals.resolved / totals.validated) * 1000) / 1000 : null,
      avgValidationMinutes: totals.avg_validation_minutes,
      byNeighborhood,
      byDay,
    };
  }

  /** CSV (separador ";" e BOM UTF-8 para abrir corretamente no Excel em português). */
  async exportCsv(query: ExportQuery): Promise<{ filename: string; content: string; rows: number }> {
    this.checkPeriod(query.from, query.to);
    const rows = await this.prisma.occurrence.findMany({
      where: {
        deletedAt: null,
        createdAt: { gte: query.from, lt: query.to },
        ...(query.status?.length && { status: { in: query.status } }),
        ...(query.severity?.length && { severity: { in: query.severity } }),
        ...(!query.includeDemo && { isDemo: false }),
      },
      orderBy: { createdAt: 'asc' },
      take: MAX_EXPORT_ROWS + 1,
      select: {
        code: true, createdAt: true, occurredAt: true, title: true, address: true, neighborhood: true,
        latitude: true, longitude: true, severity: true, status: true, confirmCount: true, contestCount: true,
        validatedAt: true, resolvedAt: true, isDemo: true,
      },
    });
    if (rows.length > MAX_EXPORT_ROWS) {
      throw new BadRequestException(`O período tem mais de ${MAX_EXPORT_ROWS} registros; reduza o intervalo`);
    }
    // Formato "2026-11-23 14:31:05" no fuso da cidade (a localidade sv-SE produz ISO sem o "T").
    const local = (d: Date | null) => (d ? d.toLocaleString('sv-SE', { timeZone: REPORT_TZ }) : null);
    const header = [
      'codigo', 'registrado_em', 'observado_em', 'titulo', 'endereco', 'bairro', 'latitude', 'longitude',
      'gravidade', 'status', 'confirmacoes', 'contestacoes', 'validado_em', 'resolvido_em', 'demonstracao',
    ];
    const lines = rows.map((r) =>
      [
        r.code, local(r.createdAt), local(r.occurredAt), r.title, r.address, r.neighborhood,
        r.latitude.toFixed(6), r.longitude.toFixed(6), SEVERITY_LABEL[r.severity], STATUS_LABEL[r.status],
        r.confirmCount, r.contestCount, local(r.validatedAt), local(r.resolvedAt), r.isDemo ? 'sim' : 'não',
      ]
        .map(csvCell)
        .join(';'),
    );
    const day = (d: Date) => d.toISOString().slice(0, 10);
    return {
      filename: `ocorrencias_${day(query.from)}_${day(query.to)}.csv`,
      content: '﻿' + [header.join(';'), ...lines].join('\r\n') + '\r\n',
      rows: rows.length,
    };
  }

  private checkPeriod(from: Date, to: Date) {
    if (to <= from) throw new BadRequestException('A data final deve ser posterior à inicial');
    if ((to.getTime() - from.getTime()) / 86_400_000 > MAX_PERIOD_DAYS) {
      throw new BadRequestException(`O período máximo é de ${MAX_PERIOD_DAYS} dias`);
    }
  }
}
