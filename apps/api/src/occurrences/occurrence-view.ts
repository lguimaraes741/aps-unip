import { OccurrenceSummary } from '@alertacidade/shared-types';
import { OccurrenceStatus, Severity } from '@prisma/client';
import { API_PREFIX } from '../bootstrap';

export const photoUrl = (photoId: string) => `/${API_PREFIX}/photos/${photoId}`;

/** Linha retornada pelas consultas SQL de listagem. */
export interface OccurrenceRow {
  id: string;
  code: number;
  title: string;
  address: string;
  neighborhood: string | null;
  latitude: number;
  longitude: number;
  severity: Severity;
  status: OccurrenceStatus;
  occurred_at: Date;
  created_at: Date;
  updated_at: Date;
  confirm_count: number;
  contest_count: number;
  is_demo: boolean;
  cover_photo_id: string | null;
  distance_meters: number | null;
}

export function toSummary(row: OccurrenceRow): OccurrenceSummary & { updatedAt: string } {
  return {
    id: row.id,
    code: row.code,
    title: row.title,
    address: row.address,
    neighborhood: row.neighborhood,
    latitude: row.latitude,
    longitude: row.longitude,
    severity: row.severity,
    status: row.status,
    occurredAt: row.occurred_at.toISOString(),
    createdAt: row.created_at.toISOString(),
    updatedAt: row.updated_at.toISOString(),
    confirmCount: row.confirm_count,
    contestCount: row.contest_count,
    coverPhotoUrl: row.cover_photo_id ? photoUrl(row.cover_photo_id) : null,
    ...(row.distance_meters !== null && { distanceMeters: Math.round(row.distance_meters) }),
    isDemo: row.is_demo,
  };
}

/** Escapa curingas do ILIKE para que a busca do usuário seja literal. */
export function likePattern(term: string): string {
  return `%${term.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
}
