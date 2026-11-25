-- Fase 7, Etapa 6: chaves de agrupamento de eventos de notícia (cidades/distritos IBGE e logradouros).
-- Aditiva. O índice GIN atende a busca de eventos candidatos por cidade (city_ibges && ARRAY[...]).

-- AlterTable
ALTER TABLE "news_events" ADD COLUMN     "city_ibges" VARCHAR(7)[] DEFAULT ARRAY[]::VARCHAR(7)[],
ADD COLUMN     "district_ibges" VARCHAR(12)[] DEFAULT ARRAY[]::VARCHAR(12)[],
ADD COLUMN     "places" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateIndex
CREATE INDEX "news_events_city_ibges_idx" ON "news_events" USING GIN ("city_ibges");


ALTER TABLE "news_events"
  ADD CONSTRAINT news_events_city_ibges_format CHECK (city_ibges <@ ARRAY[]::varchar(7)[] OR array_to_string(city_ibges, ',') ~ '^[0-9]{7}(,[0-9]{7})*$');
