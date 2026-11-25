// Garante que as combinações de cor do design system atendem à WCAG 2.2:
//  - texto: contraste >= 4.5:1 (critério 1.4.3, nível AA)
//  - componentes não textuais (marcadores no mapa): >= 3:1 (critério 1.4.11)
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const tokens = JSON.parse(readFileSync(new URL('../tokens.json', import.meta.url), 'utf8'));
const { brand, neutral, severity, status } = tokens.color;

function luminance(hex) {
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const lin = (c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

export function contrast(a, b) {
  const [l1, l2] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (l1 + 0.05) / (l2 + 0.05);
}

const TEXT = 4.5;
const NON_TEXT = 3;

function expectContrast(fg, bg, min, label) {
  const ratio = contrast(fg, bg);
  assert.ok(ratio >= min, `${label}: ${fg} sobre ${bg} = ${ratio.toFixed(2)}:1 (mínimo ${min}:1)`);
}

test('a função de contraste reproduz valores de referência da WCAG', () => {
  assert.equal(contrast('#000000', '#FFFFFF').toFixed(1), '21.0');
  assert.equal(contrast('#FFFFFF', '#FFFFFF').toFixed(1), '1.0');
});

test('textos principais e secundários são legíveis no fundo e nas superfícies', () => {
  for (const bg of [neutral.background, neutral.surface, neutral.surfaceMuted]) {
    expectContrast(neutral.textPrimary, bg, TEXT, 'textPrimary');
    expectContrast(neutral.textSecondary, bg, TEXT, 'textSecondary');
  }
});

test('texto sobre a cor principal (cabeçalho, botões, sidebar)', () => {
  expectContrast(brand.onPrimary, brand.primary, TEXT, 'onPrimary/primary');
  expectContrast(brand.onPrimary, brand.primaryDark, TEXT, 'onPrimary/primaryDark');
  expectContrast(brand.primary, brand.primaryLight, TEXT, 'primary/primaryLight');
  expectContrast(brand.primary, neutral.surface, TEXT, 'link primary/surface');
});

test('badges de gravidade têm texto legível', () => {
  for (const [key, s] of Object.entries(severity)) expectContrast(s.fg, s.bg, TEXT, `severity ${key}`);
});

test('badges de status têm texto legível', () => {
  for (const [key, s] of Object.entries(status)) expectContrast(s.fg, s.bg, TEXT, `status ${key}`);
});

test('marcadores de gravidade se destacam do mapa claro (componente não textual)', () => {
  for (const [key, s] of Object.entries(severity)) expectContrast(s.marker, '#FFFFFF', NON_TEXT, `marker ${key}`);
});

test('gravidade e status usam paletas distintas e completas', () => {
  assert.deepEqual(Object.keys(severity), ['LOW', 'MODERATE', 'HIGH', 'CRITICAL']);
  assert.deepEqual(Object.keys(status), ['PENDING', 'UNDER_REVIEW', 'VALIDATED', 'REJECTED', 'RESOLVED']);
  for (const s of Object.values(status)) assert.ok(s.icon, 'todo status precisa de ícone (cor não pode ser o único indicador)');
});
