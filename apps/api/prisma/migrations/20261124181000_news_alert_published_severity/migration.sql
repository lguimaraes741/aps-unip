-- Fase 7, Etapa 10: gravidade com que o alerta está publicado (distinta da gravidade notificada).

-- AlterTable
ALTER TABLE "news_alerts" ADD COLUMN     "published_severity" "severity";

