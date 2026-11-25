import type { Severity } from '@alertacidade/shared-types';
import { tokens } from '@alertacidade/design-tokens';
import { SEVERITIES } from './format';

/** Cores de marcador do design system (com contraste ≥ 3:1 sobre o mapa claro). */
export const SEVERITY_MARKER = Object.fromEntries(SEVERITIES.map((s) => [s, tokens.color.severity[s].marker])) as Record<Severity, string>;
