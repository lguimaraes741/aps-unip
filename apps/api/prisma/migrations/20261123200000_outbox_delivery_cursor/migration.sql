-- Cursor de entrega do outbox (Fase 4).
--
-- `domain_events.sequence` é gerado no INSERT, mas as transações confirmam fora de ordem:
-- A recebe 10, B recebe 11, B confirma primeiro. Um cliente que já viu o 11 descartaria o 10
-- (e `GET /sync?since=11` também não o devolveria) — evento perdido.
-- `published_sequence` é atribuído pelo publicador, sob lock exclusivo, na ordem em que publica:
-- todo evento entregue depois recebe número maior. Clientes e /sync usam este cursor.

CREATE SEQUENCE "domain_events_published_sequence_seq" AS BIGINT;

ALTER TABLE "domain_events" ADD COLUMN "published_sequence" BIGINT;
ALTER SEQUENCE "domain_events_published_sequence_seq" OWNED BY "domain_events"."published_sequence";

CREATE UNIQUE INDEX "domain_events_published_sequence_key" ON "domain_events"("published_sequence");

-- Publicado <=> tem cursor de entrega.
ALTER TABLE "domain_events"
  ADD CONSTRAINT domain_events_published_consistency
  CHECK ((published_at IS NULL) = (published_sequence IS NULL));
