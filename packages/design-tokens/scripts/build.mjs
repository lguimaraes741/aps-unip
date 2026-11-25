// Gera os artefatos do design system a partir de tokens.json:
//   dist/tokens.css   -> variáveis CSS para o painel administrativo (React)
//   dist/index.js     -> objeto JS (ESM) + dist/index.d.ts
//   dist/flutter/app_tokens.dart -> constantes Dart para o app Flutter
// Uso: node scripts/build.mjs
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tokens = JSON.parse(readFileSync(join(root, 'tokens.json'), 'utf8'));
delete tokens.$description;
const dist = join(root, 'dist');
mkdirSync(join(dist, 'flutter'), { recursive: true });

const HEADER = 'GERADO AUTOMATICAMENTE por packages/design-tokens/scripts/build.mjs — não edite manualmente.';
const kebab = (s) => s.replace(/([a-z0-9])([A-Z])/g, '$1-$2').replace(/_/g, '-').toLowerCase();
const camel = (s) => s.toLowerCase().replace(/_([a-z])/g, (_, c) => c.toUpperCase());

// ---------- CSS ----------
const css = [];
for (const [group, values] of Object.entries(tokens.color)) {
  for (const [name, value] of Object.entries(values)) {
    if (typeof value === 'string') {
      css.push(`  --ac-color-${kebab(group)}-${kebab(name)}: ${value};`);
    } else {
      for (const key of ['base', 'marker', 'bg', 'fg']) {
        if (value[key]) css.push(`  --ac-${kebab(group)}-${kebab(name)}-${key}: ${value[key]};`);
      }
    }
  }
}
const fontStack = [`'${tokens.typography.fontFamily}'`, ...tokens.typography.fontFallback.map((f) => (f.includes(' ') ? `'${f}'` : f))].join(', ');
css.push(`  --ac-font-family: ${fontStack};`);
for (const [name, t] of Object.entries(tokens.typography.scale)) {
  css.push(`  --ac-font-${kebab(name)}-size: ${t.size}px;`);
  css.push(`  --ac-font-${kebab(name)}-line-height: ${t.lineHeight}px;`);
  css.push(`  --ac-font-${kebab(name)}-weight: ${t.weight};`);
}
for (const [name, v] of Object.entries(tokens.spacing)) css.push(`  --ac-space-${name}: ${v}px;`);
for (const [name, v] of Object.entries(tokens.radius)) css.push(`  --ac-radius-${name}: ${v}px;`);
for (const [name, v] of Object.entries(tokens.elevation)) css.push(`  --ac-shadow-${name}: ${v};`);
css.push(`  --ac-motion-fast: ${tokens.motion.fast}ms;`);
css.push(`  --ac-motion-base: ${tokens.motion.base}ms;`);
css.push(`  --ac-motion-slow: ${tokens.motion.slow}ms;`);
css.push(`  --ac-motion-easing: ${tokens.motion.easing};`);
for (const [name, v] of Object.entries(tokens.layout)) css.push(`  --ac-layout-${kebab(name)}: ${v}px;`);
writeFileSync(join(dist, 'tokens.css'), `/* ${HEADER} */\n:root {\n${css.join('\n')}\n}\n`);

// ---------- JS + d.ts ----------
writeFileSync(
  join(dist, 'index.js'),
  `// ${HEADER}\nexport const tokens = Object.freeze(${JSON.stringify(tokens, null, 2)});\nexport default tokens;\n`,
);
writeFileSync(
  join(dist, 'index.d.ts'),
  `// ${HEADER}\ndeclare const tokens: ${JSON.stringify(tokens, null, 2)};\nexport { tokens };\nexport default tokens;\n`,
);

// ---------- Dart ----------
const dartColor = (hex) => `Color(0xFF${hex.replace('#', '').toUpperCase()})`;
const dart = [];
dart.push(`// ${HEADER}`);
dart.push('// ignore_for_file: constant_identifier_names');
dart.push("import 'package:flutter/painting.dart';");
dart.push('');
dart.push('/// Cores base do AlertaCidade.');
dart.push('abstract final class AcColors {');
for (const group of ['brand', 'neutral', 'feedback']) {
  for (const [name, value] of Object.entries(tokens.color[group])) {
    dart.push(`  static const ${name} = ${dartColor(value)};`);
  }
}
dart.push('}');
dart.push('');
dart.push('/// Paleta de um nível de gravidade ou status (base, fundo do badge e texto acessível).');
dart.push('final class AcTonePalette {');
dart.push('  const AcTonePalette({required this.label, required this.base, required this.marker, required this.bg, required this.fg});');
dart.push('  final String label;');
dart.push('  final Color base;');
dart.push('  final Color marker;');
dart.push('  final Color bg;');
dart.push('  final Color fg;');
dart.push('}');
for (const group of ['severity', 'status']) {
  const cls = group === 'severity' ? 'AcSeverityColors' : 'AcStatusColors';
  dart.push('');
  dart.push(`abstract final class ${cls} {`);
  const entries = Object.entries(tokens.color[group]);
  for (const [key, v] of entries) {
    dart.push(
      `  static const ${camel(key)} = AcTonePalette(label: '${v.label}', base: ${dartColor(v.base)}, marker: ${dartColor(v.marker ?? v.base)}, bg: ${dartColor(v.bg)}, fg: ${dartColor(v.fg)});`,
    );
  }
  dart.push(`  /// Busca pelo valor do enum da API (ex.: '${entries[0][0]}').`);
  dart.push(`  static const byApiValue = <String, AcTonePalette>{`);
  for (const [key] of entries) dart.push(`    '${key}': ${camel(key)},`);
  dart.push('  };');
  dart.push('}');
}
dart.push('');
dart.push('abstract final class AcSpacing {');
for (const [name, v] of Object.entries(tokens.spacing)) dart.push(`  static const double ${name} = ${v};`);
dart.push('}');
dart.push('');
dart.push('abstract final class AcRadius {');
for (const [name, v] of Object.entries(tokens.radius)) dart.push(`  static const double ${name} = ${v};`);
dart.push('}');
dart.push('');
dart.push('/// Escala tipográfica (tamanho, altura de linha em px e peso).');
dart.push('abstract final class AcTypeScale {');
dart.push(`  static const fontFamily = '${tokens.typography.fontFamily}';`);
for (const [name, t] of Object.entries(tokens.typography.scale)) {
  dart.push(
    `  static const ${name} = TextStyle(fontFamily: fontFamily, fontSize: ${t.size}, height: ${(t.lineHeight / t.size).toFixed(4)}, fontWeight: FontWeight.w${t.weight});`,
  );
}
dart.push('}');
dart.push('');
dart.push('abstract final class AcMotion {');
dart.push(`  static const fast = Duration(milliseconds: ${tokens.motion.fast});`);
dart.push(`  static const base = Duration(milliseconds: ${tokens.motion.base});`);
dart.push(`  static const slow = Duration(milliseconds: ${tokens.motion.slow});`);
dart.push('}');
dart.push('');
// Sombras: "0 4px 8px -2px rgba(16, 24, 40, 0.10), …" → lista de BoxShadow (mesmos valores do CSS).
const dartShadows = (value) =>
  value.split(/,(?![^(]*\))/).map((part) => {
    const m = /^\s*(-?\d+)(?:px)?\s+(-?\d+)(?:px)?\s+(\d+)(?:px)?(?:\s+(-?\d+)(?:px)?)?\s+rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)\s*$/.exec(part);
    if (!m) throw new Error(`Sombra inválida: ${part}`);
    const [, x, y, blur, spread = '0', r, g, b, a] = m;
    const hex = [Math.round(Number(a) * 255), r, g, b].map((n) => Number(n).toString(16).padStart(2, '0')).join('').toUpperCase();
    return `BoxShadow(offset: Offset(${x}, ${y}), blurRadius: ${blur}, spreadRadius: ${spread}, color: Color(0x${hex}))`;
  });
dart.push('/// Elevação (mesmos valores das sombras --ac-shadow-* do painel).');
dart.push('abstract final class AcElevation {');
for (const [name, v] of Object.entries(tokens.elevation)) dart.push(`  static const ${name} = <BoxShadow>[${dartShadows(v).join(', ')}];`);
dart.push('}');
dart.push('');
dart.push('abstract final class AcLayout {');
for (const [name, v] of Object.entries(tokens.layout)) dart.push(`  static const double ${name} = ${v};`);
dart.push('}');
writeFileSync(join(dist, 'flutter', 'app_tokens.dart'), dart.join('\n') + '\n');

// Copia para o app Flutter (que não consome pacotes npm).
const mobileTheme = join(root, '..', '..', 'apps', 'mobile', 'lib', 'core', 'theme');
if (existsSync(join(root, '..', '..', 'apps', 'mobile', 'pubspec.yaml'))) {
  mkdirSync(mobileTheme, { recursive: true });
  writeFileSync(join(mobileTheme, 'app_tokens.g.dart'), dart.join('\n') + '\n');
}

console.log('[design-tokens] gerados: dist/tokens.css, dist/index.js, dist/index.d.ts, dist/flutter/app_tokens.dart, apps/mobile/lib/core/theme/app_tokens.g.dart');
