import { PrismaClient } from '@prisma/client';
import localidades from './data/ibge-localidades.json';
import malhas from './data/malhas-municipios.json';

/**
 * Carrega o gazetteer em news_regions (idempotente).
 *  - CITY: 16 municípios monitorados, com contorno OFICIAL (IBGE, API de Malhas v3);
 *  - DISTRICT: 96 distritos da capital, SEM contorno — a API de malhas do IBGE não fornece
 *    distritos; não desenhamos polígono à mão (o contorno oficial existe no GeoSampa, pendente);
 *  - METRO: "Grande São Paulo (monitorada)" = ST_Union dos municípios, calculada pelo PostGIS;
 *  - STATE: São Paulo, sem contorno (não é usada no mapa).
 */
export const METRO_NAME = 'Grande São Paulo (cidades monitoradas)';
export const SAO_PAULO_IBGE = '3550308';

export async function seedRegions(prisma: PrismaClient): Promise<{ cities: number; districts: number }> {
  const state = await prisma.newsRegion.upsert({
    where: { kind_state_name: { kind: 'STATE', state: 'SP', name: 'São Paulo' } },
    create: { kind: 'STATE', state: 'SP', name: 'São Paulo', ibgeCode: '35', monitored: false },
    update: {},
  });

  const cityIds = new Map<string, string>();
  for (const f of malhas.features) {
    const { ibge, name } = f.properties;
    const city = await prisma.newsRegion.upsert({
      where: { ibgeCode: ibge },
      create: { kind: 'CITY', state: 'SP', name, ibgeCode: ibge, parentId: state.id, monitored: true },
      update: { name, parentId: state.id, monitored: true },
    });
    cityIds.set(ibge, city.id);
    await prisma.$executeRaw`
      UPDATE news_regions
      SET boundary = ST_Multi(ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON(${JSON.stringify(f.geometry)}), 4326)))::geography
      WHERE id = ${city.id}::uuid`;
  }

  const spId = cityIds.get(SAO_PAULO_IBGE)!;
  for (const d of localidades.saoPauloDistricts) {
    await prisma.newsRegion.upsert({
      where: { ibgeCode: d.ibge },
      create: { kind: 'DISTRICT', state: 'SP', name: d.name, ibgeCode: d.ibge, parentId: spId, monitored: true },
      update: { name: d.name, parentId: spId, monitored: true },
    });
  }

  const metro = await prisma.newsRegion.upsert({
    where: { kind_state_name: { kind: 'METRO', state: 'SP', name: METRO_NAME } },
    create: { kind: 'METRO', state: 'SP', name: METRO_NAME, parentId: state.id, monitored: true },
    update: { parentId: state.id, monitored: true },
  });
  await prisma.$executeRaw`
    UPDATE news_regions m
    SET boundary = (
      SELECT ST_Multi(ST_Union(c.boundary::geometry))::geography
      FROM news_regions c WHERE c.kind = 'CITY' AND c.monitored)
    WHERE m.id = ${metro.id}::uuid`;

  return { cities: cityIds.size, districts: localidades.saoPauloDistricts.length };
}
