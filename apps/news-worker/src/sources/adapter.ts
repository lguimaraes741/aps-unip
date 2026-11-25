import { FetchOptions } from './http';
import { RawNewsItem } from './rss';

/** Configuração de uma fonte (espelha news_sources). */
export interface SourceConfig {
  id: string;
  key: string;
  type: 'RSS' | 'GDELT' | 'API';
  feedUrl: string;
  minRequestIntervalMs: number;
  config: Record<string, unknown>;
}

export interface CollectOutput {
  items: RawNewsItem[];
  httpStatus: number;
  notModified: boolean;
  /** Para a próxima requisição condicional. */
  etag: string | null;
  lastModified: string | null;
}

/**
 * Conector de uma fonte. Trocar ou acrescentar fonte = um adaptador novo, sem mexer no pipeline.
 * O adaptador só traz itens brutos; normalização, filtro e gravação são do coletor.
 */
export interface NewsSourceAdapter {
  readonly type: SourceConfig['type'];
  collect(source: SourceConfig, http: Pick<FetchOptions, 'etag' | 'lastModified' | 'allowPrivateNetwork' | 'timeoutMs'>): Promise<CollectOutput>;
}
