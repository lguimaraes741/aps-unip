-- =============================================================================
-- Fase 7 — News Intelligence (docs/architecture/07-news-intelligence.md, seção 7.4)
--   (1) tabelas, enums e índices (gerado por `prisma migrate diff`);
--   (2) trigger de geolocalização de news_events (reaproveita a função da migration init);
--   (3) CHECK constraints — as regras de publicação que o banco também garante.
-- Migration puramente aditiva: nenhuma tabela existente é alterada além das FKs novas.
-- =============================================================================

-- CreateEnum
CREATE TYPE "news_source_type" AS ENUM ('RSS', 'GDELT', 'API');

-- CreateEnum
CREATE TYPE "news_source_reliability" AS ENUM ('OFFICIAL', 'ESTABLISHED_PRESS', 'AGGREGATOR', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "news_article_status" AS ENUM ('COLLECTED', 'ANALYZING', 'ANALYZED', 'IRRELEVANT', 'DUPLICATE', 'FAILED');

-- CreateEnum
CREATE TYPE "news_temporality" AS ENUM ('CURRENT', 'FORECAST', 'PREVENTION', 'HISTORICAL', 'RESOLVED', 'UNCERTAIN');

-- CreateEnum
CREATE TYPE "news_confidence" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "news_event_type" AS ENUM ('FLOODING', 'RIVER_OVERFLOW', 'FLASH_FLOOD');

-- CreateEnum
CREATE TYPE "news_event_status" AS ENUM ('AWAITING_VALIDATION', 'PUBLISHED_PRELIMINARY', 'PUBLISHED_VERIFIED', 'DISCARDED', 'OUTDATED', 'RESOLVED');

-- CreateEnum
CREATE TYPE "location_precision" AS ENUM ('EXACT', 'STREET', 'NEIGHBORHOOD', 'CITY', 'REGION', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "news_region_kind" AS ENUM ('STATE', 'METRO', 'CITY', 'DISTRICT', 'NEIGHBORHOOD');

-- CreateEnum
CREATE TYPE "news_alert_level" AS ENUM ('PRELIMINARY', 'VERIFIED', 'OFFICIAL');

-- CreateEnum
CREATE TYPE "news_alert_status" AS ENUM ('ACTIVE', 'RETRACTED', 'RESOLVED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "news_collection_status" AS ENUM ('RUNNING', 'SUCCEEDED', 'FAILED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "news_collection_trigger" AS ENUM ('SCHEDULE', 'MANUAL', 'RETRY');

-- CreateEnum
CREATE TYPE "news_link_origin" AS ENUM ('AUTO', 'MODERATOR');

-- CreateTable
CREATE TABLE "news_sources" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "key" VARCHAR(60) NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "type" "news_source_type" NOT NULL,
    "reliability" "news_source_reliability" NOT NULL,
    "base_url" VARCHAR(500) NOT NULL,
    "feed_url" VARCHAR(1000) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "collection_interval_sec" INTEGER NOT NULL DEFAULT 900,
    "min_request_interval_ms" INTEGER NOT NULL DEFAULT 2000,
    "default_city_ibge" VARCHAR(7),
    "config" JSONB NOT NULL DEFAULT '{}',
    "terms_checked_at" TIMESTAMPTZ(3),
    "terms_note" VARCHAR(500),
    "last_attempt_at" TIMESTAMPTZ(3),
    "last_successful_collection_at" TIMESTAMPTZ(3),
    "consecutive_failures" INTEGER NOT NULL DEFAULT 0,
    "next_attempt_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "news_sources_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "news_collection_jobs" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "source_id" UUID NOT NULL,
    "status" "news_collection_status" NOT NULL DEFAULT 'RUNNING',
    "trigger" "news_collection_trigger" NOT NULL,
    "requested_by_id" UUID,
    "started_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMPTZ(3),
    "duration_ms" INTEGER,
    "http_status" INTEGER,
    "items_found" INTEGER NOT NULL DEFAULT 0,
    "items_new" INTEGER NOT NULL DEFAULT 0,
    "error_message" VARCHAR(500),

    CONSTRAINT "news_collection_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "news_articles" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "source_id" UUID NOT NULL,
    "collection_job_id" UUID,
    "external_id" VARCHAR(500),
    "title" VARCHAR(500) NOT NULL,
    "url" VARCHAR(2000) NOT NULL,
    "canonical_url" VARCHAR(2000) NOT NULL,
    "url_hash" CHAR(64) NOT NULL,
    "title_fingerprint" VARCHAR(500) NOT NULL,
    "published_at" TIMESTAMPTZ(3),
    "collected_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "summary" VARCHAR(500),
    "author" VARCHAR(200),
    "language" VARCHAR(10) NOT NULL DEFAULT 'pt',
    "processing_status" "news_article_status" NOT NULL DEFAULT 'COLLECTED',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_error" VARCHAR(500),
    "duplicate_of_id" UUID,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "news_articles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "news_analyses" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "article_id" UUID NOT NULL,
    "rules_version" VARCHAR(20) NOT NULL,
    "model_version" VARCHAR(60) NOT NULL DEFAULT 'none',
    "is_relevant" BOOLEAN NOT NULL,
    "temporality" "news_temporality",
    "event_type" "news_event_type",
    "estimated_severity" "severity",
    "confidence" "news_confidence",
    "location_precision" "location_precision" NOT NULL DEFAULT 'UNKNOWN',
    "needs_review" BOOLEAN NOT NULL DEFAULT false,
    "extracted_data" JSONB NOT NULL,
    "reasoning_summary" VARCHAR(1000) NOT NULL,
    "analyzed_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "news_analyses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "news_regions" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "kind" "news_region_kind" NOT NULL,
    "name" VARCHAR(120) NOT NULL,
    "state" CHAR(2) NOT NULL,
    "ibge_code" VARCHAR(12),
    "parent_id" UUID,
    "aliases" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "boundary" geography(MultiPolygon, 4326),
    "monitored" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "news_regions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "news_events" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "code" SERIAL NOT NULL,
    "event_type" "news_event_type" NOT NULL,
    "status" "news_event_status" NOT NULL DEFAULT 'AWAITING_VALIDATION',
    "title" VARCHAR(200) NOT NULL,
    "region_id" UUID,
    "city" VARCHAR(120),
    "state" CHAR(2),
    "place_text" VARCHAR(255),
    "location_precision" "location_precision" NOT NULL,
    "latitude" DOUBLE PRECISION,
    "longitude" DOUBLE PRECISION,
    "location" geography(Point, 4326),
    "estimated_severity" "severity",
    "confidence" "news_confidence" NOT NULL,
    "independent_sources" INTEGER NOT NULL DEFAULT 1,
    "urgent_review" BOOLEAN NOT NULL DEFAULT false,
    "decision_reasons" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "rules_version" VARCHAR(20) NOT NULL,
    "event_occurred_at" TIMESTAMPTZ(3),
    "first_evidence_at" TIMESTAMPTZ(3) NOT NULL,
    "last_evidence_at" TIMESTAMPTZ(3) NOT NULL,
    "related_occurrence_id" UUID,
    "moderated_by_id" UUID,
    "moderation_note" VARCHAR(500),
    "version" INTEGER NOT NULL DEFAULT 1,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "news_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "news_event_articles" (
    "event_id" UUID NOT NULL,
    "article_id" UUID NOT NULL,
    "is_independent" BOOLEAN NOT NULL,
    "derived_from_article_id" UUID,
    "similarity" DOUBLE PRECISION,
    "linked_by" "news_link_origin" NOT NULL DEFAULT 'AUTO',
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "news_event_articles_pkey" PRIMARY KEY ("event_id","article_id")
);

-- CreateTable
CREATE TABLE "news_alerts" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "event_id" UUID NOT NULL,
    "level" "news_alert_level" NOT NULL,
    "status" "news_alert_status" NOT NULL DEFAULT 'ACTIVE',
    "notified_severity" "severity",
    "last_notified_at" TIMESTAMPTZ(3),
    "revision" INTEGER NOT NULL DEFAULT 1,
    "published_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "reviewed_by_id" UUID,
    "retraction_reason" VARCHAR(500),
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "news_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "news_sources_key_key" ON "news_sources"("key");

-- CreateIndex
CREATE INDEX "news_sources_enabled_next_attempt_at_idx" ON "news_sources"("enabled", "next_attempt_at");

-- CreateIndex
CREATE INDEX "news_collection_jobs_source_id_started_at_idx" ON "news_collection_jobs"("source_id", "started_at");

-- CreateIndex
CREATE INDEX "news_collection_jobs_status_started_at_idx" ON "news_collection_jobs"("status", "started_at");

-- CreateIndex
CREATE UNIQUE INDEX "news_articles_url_hash_key" ON "news_articles"("url_hash");

-- CreateIndex
CREATE INDEX "news_articles_processing_status_collected_at_idx" ON "news_articles"("processing_status", "collected_at");

-- CreateIndex
CREATE INDEX "news_articles_published_at_idx" ON "news_articles"("published_at");

-- CreateIndex
CREATE INDEX "news_articles_title_fingerprint_idx" ON "news_articles"("title_fingerprint");

-- CreateIndex
CREATE UNIQUE INDEX "news_articles_source_id_external_id_key" ON "news_articles"("source_id", "external_id");

-- CreateIndex
CREATE INDEX "news_analyses_analyzed_at_idx" ON "news_analyses"("analyzed_at");

-- CreateIndex
CREATE UNIQUE INDEX "news_analyses_article_id_rules_version_model_version_key" ON "news_analyses"("article_id", "rules_version", "model_version");

-- CreateIndex
CREATE UNIQUE INDEX "news_regions_ibge_code_key" ON "news_regions"("ibge_code");

-- CreateIndex
CREATE INDEX "news_regions_boundary_idx" ON "news_regions" USING GIST ("boundary");

-- CreateIndex
CREATE UNIQUE INDEX "news_regions_kind_state_name_key" ON "news_regions"("kind", "state", "name");

-- CreateIndex
CREATE UNIQUE INDEX "news_events_code_key" ON "news_events"("code");

-- CreateIndex
CREATE INDEX "news_events_status_last_evidence_at_idx" ON "news_events"("status", "last_evidence_at");

-- CreateIndex
CREATE INDEX "news_events_region_id_last_evidence_at_idx" ON "news_events"("region_id", "last_evidence_at");

-- CreateIndex
CREATE INDEX "news_events_location_idx" ON "news_events" USING GIST ("location");

-- CreateIndex
CREATE UNIQUE INDEX "news_event_articles_article_id_key" ON "news_event_articles"("article_id");

-- CreateIndex
CREATE UNIQUE INDEX "news_alerts_event_id_key" ON "news_alerts"("event_id");

-- CreateIndex
CREATE INDEX "news_alerts_status_expires_at_idx" ON "news_alerts"("status", "expires_at");

-- AddForeignKey
ALTER TABLE "news_collection_jobs" ADD CONSTRAINT "news_collection_jobs_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "news_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "news_collection_jobs" ADD CONSTRAINT "news_collection_jobs_requested_by_id_fkey" FOREIGN KEY ("requested_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "news_articles" ADD CONSTRAINT "news_articles_source_id_fkey" FOREIGN KEY ("source_id") REFERENCES "news_sources"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "news_articles" ADD CONSTRAINT "news_articles_collection_job_id_fkey" FOREIGN KEY ("collection_job_id") REFERENCES "news_collection_jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "news_articles" ADD CONSTRAINT "news_articles_duplicate_of_id_fkey" FOREIGN KEY ("duplicate_of_id") REFERENCES "news_articles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "news_analyses" ADD CONSTRAINT "news_analyses_article_id_fkey" FOREIGN KEY ("article_id") REFERENCES "news_articles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "news_regions" ADD CONSTRAINT "news_regions_parent_id_fkey" FOREIGN KEY ("parent_id") REFERENCES "news_regions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "news_events" ADD CONSTRAINT "news_events_region_id_fkey" FOREIGN KEY ("region_id") REFERENCES "news_regions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "news_events" ADD CONSTRAINT "news_events_related_occurrence_id_fkey" FOREIGN KEY ("related_occurrence_id") REFERENCES "occurrences"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "news_events" ADD CONSTRAINT "news_events_moderated_by_id_fkey" FOREIGN KEY ("moderated_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "news_event_articles" ADD CONSTRAINT "news_event_articles_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "news_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "news_event_articles" ADD CONSTRAINT "news_event_articles_article_id_fkey" FOREIGN KEY ("article_id") REFERENCES "news_articles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "news_event_articles" ADD CONSTRAINT "news_event_articles_derived_from_article_id_fkey" FOREIGN KEY ("derived_from_article_id") REFERENCES "news_articles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "news_alerts" ADD CONSTRAINT "news_alerts_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "news_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "news_alerts" ADD CONSTRAINT "news_alerts_reviewed_by_id_fkey" FOREIGN KEY ("reviewed_by_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;


-- =============================================================================
-- (2) Ponto do evento derivado de latitude/longitude (a aplicação nunca escreve em location).
-- =============================================================================
CREATE TRIGGER news_events_set_location
  BEFORE INSERT OR UPDATE OF latitude, longitude, location ON "news_events"
  FOR EACH ROW EXECUTE FUNCTION set_location_from_coordinates();

-- =============================================================================
-- (3) Regras de integridade
-- =============================================================================
ALTER TABLE "news_sources"
  ADD CONSTRAINT news_sources_key_format CHECK (key ~ '^[a-z0-9][a-z0-9-]{1,59}$'),
  ADD CONSTRAINT news_sources_urls_http CHECK (base_url ~ '^https?://' AND feed_url ~ '^https?://'),
  -- Não martelar fontes: no mínimo 5 min entre coletas e 1 s entre requisições ao mesmo host.
  ADD CONSTRAINT news_sources_interval CHECK (collection_interval_sec BETWEEN 300 AND 86400),
  ADD CONSTRAINT news_sources_min_request_interval CHECK (min_request_interval_ms >= 1000),
  ADD CONSTRAINT news_sources_failures CHECK (consecutive_failures >= 0),
  -- Fonte só pode ser ligada depois de conferidos os termos de uso.
  ADD CONSTRAINT news_sources_terms_before_enable CHECK (NOT enabled OR terms_checked_at IS NOT NULL);

ALTER TABLE "news_collection_jobs"
  ADD CONSTRAINT news_collection_jobs_finished CHECK ((status = 'RUNNING') = (finished_at IS NULL)),
  ADD CONSTRAINT news_collection_jobs_items CHECK (items_found >= 0 AND items_new BETWEEN 0 AND items_found),
  ADD CONSTRAINT news_collection_jobs_duration CHECK (duration_ms IS NULL OR duration_ms >= 0);

ALTER TABLE "news_articles"
  ADD CONSTRAINT news_articles_urls_http CHECK (url ~ '^https?://' AND canonical_url ~ '^https://'),
  ADD CONSTRAINT news_articles_url_hash_format CHECK (url_hash ~ '^[0-9a-f]{64}$'),
  ADD CONSTRAINT news_articles_title_not_blank CHECK (length(btrim(title)) >= 3),
  ADD CONSTRAINT news_articles_attempts CHECK (attempts >= 0),
  ADD CONSTRAINT news_articles_not_self_duplicate CHECK (duplicate_of_id IS NULL OR duplicate_of_id <> id),
  ADD CONSTRAINT news_articles_duplicate_consistency CHECK ((processing_status = 'DUPLICATE') = (duplicate_of_id IS NOT NULL));

ALTER TABLE "news_analyses"
  ADD CONSTRAINT news_analyses_relevant_has_temporality CHECK (NOT is_relevant OR temporality IS NOT NULL);

ALTER TABLE "news_regions"
  ADD CONSTRAINT news_regions_state_format CHECK (state ~ '^[A-Z]{2}$'),
  ADD CONSTRAINT news_regions_name_not_blank CHECK (length(btrim(name)) >= 2);

ALTER TABLE "news_events"
  ADD CONSTRAINT news_events_title_not_blank CHECK (length(btrim(title)) >= 3),
  ADD CONSTRAINT news_events_state_format CHECK (state IS NULL OR state ~ '^[A-Z]{2}$'),
  ADD CONSTRAINT news_events_coordinates_pair CHECK ((latitude IS NULL) = (longitude IS NULL)),
  ADD CONSTRAINT news_events_latitude_range CHECK (latitude IS NULL OR latitude BETWEEN -90 AND 90),
  ADD CONSTRAINT news_events_longitude_range CHECK (longitude IS NULL OR longitude BETWEEN -180 AND 180),
  -- Nada de ponto falso: coordenada só quando a fonte permite localizar um logradouro.
  ADD CONSTRAINT news_events_point_requires_precision CHECK (latitude IS NULL OR location_precision IN ('EXACT', 'STREET')),
  -- Confiança baixa nunca é publicada sem um moderador.
  ADD CONSTRAINT news_events_publish_requires_confidence CHECK (
    status NOT IN ('PUBLISHED_PRELIMINARY', 'PUBLISHED_VERIFIED') OR confidence <> 'LOW' OR moderated_by_id IS NOT NULL),
  ADD CONSTRAINT news_events_independent_sources CHECK (independent_sources >= 1),
  ADD CONSTRAINT news_events_evidence_order CHECK (last_evidence_at >= first_evidence_at),
  ADD CONSTRAINT news_events_version_positive CHECK (version >= 1);

ALTER TABLE "news_event_articles"
  ADD CONSTRAINT news_event_articles_similarity CHECK (similarity IS NULL OR similarity BETWEEN 0 AND 1),
  ADD CONSTRAINT news_event_articles_not_self_derived CHECK (derived_from_article_id IS NULL OR derived_from_article_id <> article_id);

ALTER TABLE "news_alerts"
  -- Push crítico de alerta preliminar só com revisão de moderador (requisito 5 do módulo).
  ADD CONSTRAINT news_alerts_critical_push_corroborated CHECK (
    notified_severity IS DISTINCT FROM 'CRITICAL' OR level <> 'PRELIMINARY' OR reviewed_by_id IS NOT NULL),
  ADD CONSTRAINT news_alerts_revision_positive CHECK (revision >= 1),
  ADD CONSTRAINT news_alerts_expiry_after_publish CHECK (expires_at > published_at),
  ADD CONSTRAINT news_alerts_retraction_reason CHECK (status <> 'RETRACTED' OR retraction_reason IS NOT NULL);
