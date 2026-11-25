-- Fase 7, Etapa 10: notificações de alertas de notícia.
-- Aditiva. Requer PostgreSQL 12+ (dois ADD VALUE no mesmo enum; o projeto usa o 17).

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "notification_type" ADD VALUE 'NEWS_ALERT';
ALTER TYPE "notification_type" ADD VALUE 'NEWS_ALERT_UPDATE';

-- AlterTable
ALTER TABLE "notifications" ADD COLUMN     "news_event_id" UUID;

-- CreateIndex
CREATE INDEX "notifications_news_event_id_idx" ON "notifications"("news_event_id");

-- AddForeignKey
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_news_event_id_fkey" FOREIGN KEY ("news_event_id") REFERENCES "news_events"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Uma notificação é de ocorrência OU de notícia, nunca das duas.
ALTER TABLE "notifications"
  ADD CONSTRAINT notifications_single_subject CHECK (occurrence_id IS NULL OR news_event_id IS NULL);
