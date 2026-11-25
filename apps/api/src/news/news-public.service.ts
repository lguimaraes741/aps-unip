import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { LocationPrecision, NewsAlertLevel, NewsAlertStatus, NewsEventType, NewsSourceReliability, Prisma, Severity } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ListNewsAlertsQuery } from './news-public.dto';

/** Linha da consulta pública (um alerta publicado + seu evento). */
interface AlertRow {
  event_id: string;
  alert_id: string;
  code: number;
  event_type: NewsEventType;
  title: string;
  level: NewsAlertLevel;
  alert_status: NewsAlertStatus;
  severity: Severity | null;
  city: string | null;
  state: string | null;
  region_name: string | null;
  place_text: string | null;
  location_precision: LocationPrecision;
  latitude: number | null;
  longitude: number | null;
  area_region_id: string | null;
  center_lat: number | null;
  center_lng: number | null;
  independent_sources: number;
  article_count: bigint;
  source_count: bigint;
  primary_source_name: string | null;
  primary_source_reliability: NewsSourceReliability | null;
  primary_title: string | null;
  primary_url: string | null;
  primary_published_at: Date | null;
  primary_summary: string | null;
  event_occurred_at: Date | null;
  first_evidence_at: Date;
  last_evidence_at: Date;
  published_at: Date;
  expires_at: Date;
  updated_at: Date;
  reviewed: boolean;
  retraction_reason: string | null;
  distance_meters: number | null;
}

const ACTIVE_CONDITION = Prisma.sql`a.status = 'ACTIVE' AND e.status IN ('PUBLISHED_PRELIMINARY', 'PUBLISHED_VERIFIED') AND a.expires_at > now()`;
/** Histórico: encerrados e expirados continuam consultáveis; RETIRADO (notícia errada) nunca é listado. */
const HISTORY_CONDITION = Prisma.sql`(${ACTIVE_CONDITION} OR a.status IN ('RESOLVED', 'EXPIRED'))`;

/**
 * Colunas e junções comuns. Área do alerta = ponto (precisão ≤ rua) ou, sem ponto, o contorno
 * oficial (IBGE) da região; distrito sem contorno usa o da cidade — o mesmo critério do worker
 * de notificações para escolher destinatários.
 */
const FROM = Prisma.sql`
  FROM news_alerts a
  JOIN news_events e ON e.id = a.event_id
  LEFT JOIN news_regions r ON r.id = e.region_id
  LEFT JOIN news_regions parent ON parent.id = r.parent_id
  LEFT JOIN LATERAL (
    SELECT CASE WHEN r.boundary IS NOT NULL THEN r.id WHEN parent.boundary IS NOT NULL THEN parent.id END AS region_id,
           COALESCE(r.boundary, parent.boundary) AS boundary
  ) ar ON true
  LEFT JOIN LATERAL (
    SELECT s.name, s.reliability, art.title, art.url, art.published_at, art.summary
    FROM news_event_articles l
    JOIN news_articles art ON art.id = l.article_id
    JOIN news_sources s ON s.id = art.source_id
    WHERE l.event_id = e.id
    ORDER BY s.reliability, art.published_at ASC NULLS LAST, l.created_at
    LIMIT 1
  ) ps ON true`;

const GEO = Prisma.sql`COALESCE(e.location::geography, ar.boundary::geography)`;

const COLUMNS = Prisma.sql`
  e.id AS event_id, a.id AS alert_id, e.code, e.event_type::text AS event_type, e.title,
  a.level::text AS level, a.status::text AS alert_status, a.published_severity::text AS severity,
  e.city, e.state, r.name AS region_name, e.place_text, e.location_precision::text AS location_precision,
  e.latitude, e.longitude,
  CASE WHEN e.location IS NULL THEN ar.region_id END AS area_region_id,
  CASE WHEN e.location IS NULL AND ar.boundary IS NOT NULL THEN ST_Y(ST_PointOnSurface(ar.boundary::geometry)) END AS center_lat,
  CASE WHEN e.location IS NULL AND ar.boundary IS NOT NULL THEN ST_X(ST_PointOnSurface(ar.boundary::geometry)) END AS center_lng,
  e.independent_sources,
  (SELECT count(*) FROM news_event_articles l WHERE l.event_id = e.id) AS article_count,
  (SELECT count(DISTINCT art.source_id) FROM news_event_articles l JOIN news_articles art ON art.id = l.article_id WHERE l.event_id = e.id) AS source_count,
  ps.name AS primary_source_name, ps.reliability::text AS primary_source_reliability, ps.title AS primary_title,
  ps.url AS primary_url, ps.published_at AS primary_published_at, ps.summary AS primary_summary,
  e.event_occurred_at, e.first_evidence_at, e.last_evidence_at,
  a.published_at, a.expires_at, GREATEST(a.updated_at, e.updated_at) AS updated_at,
  (a.reviewed_by_id IS NOT NULL) AS reviewed, a.retraction_reason`;

/** Só links http(s) chegam ao app (defesa extra: o coletor já recusa outros esquemas). */
export function safeUrl(url: string | null): string | null {
  if (!url) return null;
  try {
    const u = new URL(url);
    return u.protocol === 'https:' || u.protocol === 'http:' ? u.toString() : null;
  } catch {
    return null;
  }
}

type Evidence = { label: string; severity: Severity };

/** Consequência principal relatada (mesmo critério do texto do push no news-worker). */
export function pickHeadline(severity: Severity | null, analyses: unknown[]): string | null {
  if (!severity) return null;
  for (const data of analyses) {
    const evidence = ((data ?? {}) as { severityEvidence?: Evidence[] }).severityEvidence ?? [];
    const top = evidence.find((x) => x.severity === severity);
    if (top) return top.label;
  }
  return null;
}

function toView(row: AlertRow, headline: string | null) {
  return {
    id: row.event_id,
    alertId: row.alert_id,
    code: row.code,
    eventType: row.event_type,
    title: row.title,
    headline,
    level: row.level,
    /** "Comunicado oficial" só quando a fonte é oficial; notícia nunca vira alerta da Defesa Civil. */
    isOfficial: row.level === 'OFFICIAL',
    status: row.alert_status,
    /** Null = a fonte não informa impacto ("gravidade não informada", nunca "baixa"). */
    severity: row.severity,
    city: row.city,
    state: row.state,
    regionName: row.region_name,
    placeText: row.place_text,
    locationPrecision: row.location_precision,
    latitude: row.latitude,
    longitude: row.longitude,
    /** Alerta sem ponto: região cujo contorno desenhar (GET /news/regions/:id/boundary) e um ponto interno para o rótulo. */
    areaRegionId: row.area_region_id,
    center: row.center_lat !== null && row.center_lng !== null ? { latitude: row.center_lat, longitude: row.center_lng } : null,
    independentSources: row.independent_sources,
    articleCount: Number(row.article_count),
    sourceCount: Number(row.source_count),
    primarySource: row.primary_source_name
      ? {
          name: row.primary_source_name,
          reliability: row.primary_source_reliability,
          title: row.primary_title,
          url: safeUrl(row.primary_url),
          publishedAt: row.primary_published_at?.toISOString() ?? null,
          summary: row.primary_summary,
        }
      : null,
    reviewedByModerator: row.reviewed,
    eventOccurredAt: row.event_occurred_at?.toISOString() ?? null,
    firstEvidenceAt: row.first_evidence_at.toISOString(),
    lastEvidenceAt: row.last_evidence_at.toISOString(),
    publishedAt: row.published_at.toISOString(),
    expiresAt: row.expires_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    ...(row.distance_meters !== null && { distanceMeters: Math.round(row.distance_meters) }),
  };
}

export type NewsAlertView = ReturnType<typeof toView>;

/**
 * Leitura pública do News Intelligence (Fase 7, Etapa 8): o que o app mostra no mapa e na tela de
 * notícias. Nada de moderação aqui — notas, motivos internos e quem moderou não saem da API admin.
 */
@Injectable()
export class NewsPublicService {
  constructor(private readonly prisma: PrismaService) {}

  async list(query: ListNewsAlertsQuery) {
    if ((query.lat === undefined) !== (query.lng === undefined)) throw new BadRequestException('Informe lat e lng juntos');
    const hasPoint = query.lat !== undefined && query.lng !== undefined;
    if (query.sort === 'distance' && !hasPoint) throw new BadRequestException('Ordenação por distância requer lat e lng');

    const point = hasPoint ? Prisma.sql`ST_SetSRID(ST_MakePoint(${query.lng}, ${query.lat}), 4326)::geography` : null;
    const conditions: Prisma.Sql[] = [query.scope === 'all' ? HISTORY_CONDITION : ACTIVE_CONDITION];
    if (point) conditions.push(Prisma.sql`ST_DWithin(${GEO}, ${point}, ${query.radius})`);
    if (query.severity?.length) conditions.push(Prisma.sql`a.published_severity::text = ANY(${query.severity}::text[])`);
    if (query.level?.length) conditions.push(Prisma.sql`a.level::text = ANY(${query.level}::text[])`);
    if (query.cityIbge) conditions.push(Prisma.sql`${query.cityIbge}::varchar = ANY(e.city_ibges)`);
    if (query.periodHours) conditions.push(Prisma.sql`e.last_evidence_at >= now() - make_interval(hours => ${query.periodHours}::int)`);
    if (query.source) {
      conditions.push(Prisma.sql`EXISTS (
        SELECT 1 FROM news_event_articles l JOIN news_articles art ON art.id = l.article_id JOIN news_sources s ON s.id = art.source_id
        WHERE l.event_id = e.id AND s.key = ${query.source})`);
    }
    const where = Prisma.join(conditions, ' AND ');
    const distance = point ? Prisma.sql`ST_Distance(${GEO}, ${point})` : Prisma.sql`NULL::float8`;
    const sort = query.sort ?? (hasPoint ? 'distance' : 'recent');
    const orderBy = sort === 'distance' ? Prisma.sql`distance_meters ASC NULLS LAST, e.last_evidence_at DESC` : Prisma.sql`e.last_evidence_at DESC, e.code DESC`;

    const [rows, [{ total }]] = await Promise.all([
      this.prisma.$queryRaw<AlertRow[]>`
        SELECT ${COLUMNS}, ${distance} AS distance_meters
        ${FROM}
        WHERE ${where}
        ORDER BY ${orderBy}
        LIMIT ${query.limit} OFFSET ${(query.page - 1) * query.limit}`,
      this.prisma.$queryRaw<{ total: bigint }[]>`SELECT count(*) AS total ${FROM} WHERE ${where}`,
    ]);
    const headlines = await this.headlines(rows);
    return {
      items: rows.map((r) => toView(r, headlines.get(r.event_id) ?? null)),
      total: Number(total),
      page: query.page,
      limit: query.limit,
    };
  }

  /**
   * Detalhes com todas as fontes. Vale para qualquer alerta já publicado — inclusive retirado, para
   * quem abriu o aviso de correção ver o motivo. Evento que nunca foi publicado: 404.
   */
  async findOne(eventId: string) {
    const [row] = await this.prisma.$queryRaw<AlertRow[]>`
      SELECT ${COLUMNS}, NULL::float8 AS distance_meters ${FROM} WHERE e.id = ${eventId}::uuid`;
    if (!row) throw new NotFoundException('Alerta de notícia não encontrado');

    const links = await this.prisma.newsEventArticle.findMany({
      where: { eventId },
      orderBy: { createdAt: 'asc' },
      select: {
        isIndependent: true,
        article: {
          select: {
            id: true,
            title: true,
            url: true,
            publishedAt: true,
            summary: true,
            source: { select: { name: true, reliability: true } },
            analyses: { orderBy: { analyzedAt: 'desc' }, take: 1, select: { extractedData: true } },
          },
        },
      },
    });
    const retracted = row.alert_status === 'RETRACTED';
    const sources = links
      .map((l) => ({
        id: l.article.id,
        title: l.article.title,
        sourceName: l.article.source.name,
        reliability: l.article.source.reliability,
        url: safeUrl(l.article.url),
        publishedAt: l.article.publishedAt?.toISOString() ?? null,
        summary: l.article.summary,
        /** false = republicação ou mesma agência: não conta como confirmação independente. */
        independent: l.isIndependent,
      }))
      .sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''));
    const headline = pickHeadline(row.severity, links.map((l) => l.article.analyses[0]?.extractedData));
    return {
      ...toView(row, headline),
      retractionReason: retracted ? row.retraction_reason : null,
      sources,
    };
  }

  /**
   * Opções dos filtros da tela de notícias: cidades monitoradas (gazetteer IBGE) e fontes ligadas.
   * Só nome/código público — nada da operação (URLs de feed, falhas, termos).
   */
  async filters() {
    const [cities, sources] = await Promise.all([
      this.prisma.newsRegion.findMany({
        where: { kind: 'CITY', monitored: true, ibgeCode: { not: null } },
        select: { ibgeCode: true, name: true },
        orderBy: { name: 'asc' },
      }),
      this.prisma.newsSource.findMany({ where: { enabled: true }, select: { key: true, name: true, reliability: true }, orderBy: { name: 'asc' } }),
    ]);
    return {
      cities: cities.map((c) => ({ ibge: c.ibgeCode!, name: c.name })),
      sources: sources.map((s) => ({ key: s.key, name: s.name, official: s.reliability === 'OFFICIAL' })),
    };
  }

  /** Contorno oficial (IBGE) simplificado (~50 m) para desenhar alertas regionais. Dado público e estável. */
  async boundary(regionId: string) {
    const [row] = await this.prisma.$queryRaw<{ id: string; name: string; kind: string; geojson: string }[]>`
      SELECT id, name, kind::text AS kind,
             -- ST_Multi: a simplificação devolve Polygon quando há uma parte só; o app recebe sempre MultiPolygon.
             ST_AsGeoJSON(ST_Multi(ST_SimplifyPreserveTopology(boundary::geometry, 0.0005)), 5) AS geojson
      FROM news_regions WHERE id = ${regionId}::uuid AND boundary IS NOT NULL`;
    if (!row) throw new NotFoundException('Região sem contorno');
    return { regionId: row.id, name: row.name, kind: row.kind, geometry: JSON.parse(row.geojson) as unknown };
  }

  private async headlines(rows: AlertRow[]): Promise<Map<string, string>> {
    const withSeverity = rows.filter((r) => r.severity);
    if (withSeverity.length === 0) return new Map();
    const links = await this.prisma.newsEventArticle.findMany({
      where: { eventId: { in: withSeverity.map((r) => r.event_id) } },
      orderBy: { createdAt: 'asc' },
      select: { eventId: true, article: { select: { analyses: { orderBy: { analyzedAt: 'desc' }, take: 1, select: { extractedData: true } } } } },
    });
    const result = new Map<string, string>();
    for (const r of withSeverity) {
      const data = links.filter((l) => l.eventId === r.event_id).map((l) => l.article.analyses[0]?.extractedData);
      const h = pickHeadline(r.severity, data);
      if (h) result.set(r.event_id, h);
    }
    return result;
  }
}
