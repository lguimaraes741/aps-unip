-- Fase 7: aviso imediato à moderação quando uma notícia exige revisão urgente
-- (ex.: gravidade crítica de fonte única — publicada no mapa sem push até alguém conferir).
-- Aditiva.

-- AlterEnum
ALTER TYPE "notification_type" ADD VALUE 'NEWS_REVIEW_URGENT';
