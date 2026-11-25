// GERADO AUTOMATICAMENTE por packages/design-tokens/scripts/build.mjs — não edite manualmente.
// ignore_for_file: constant_identifier_names
import 'package:flutter/painting.dart';

/// Cores base do AlertaCidade.
abstract final class AcColors {
  static const primary = Color(0xFF0754B8);
  static const primaryDark = Color(0xFF063B82);
  static const primaryLight = Color(0xFFE8F2FF);
  static const onPrimary = Color(0xFFFFFFFF);
  static const background = Color(0xFFF5F7FB);
  static const surface = Color(0xFFFFFFFF);
  static const surfaceMuted = Color(0xFFEEF2F7);
  static const textPrimary = Color(0xFF111827);
  static const textSecondary = Color(0xFF5B6476);
  static const textDisabled = Color(0xFF98A2B3);
  static const border = Color(0xFFDCE3ED);
  static const borderStrong = Color(0xFFB8C3D4);
  static const overlay = Color(0xFF0B1220);
  static const success = Color(0xFF15803D);
  static const warning = Color(0xFFB45309);
  static const error = Color(0xFFB42318);
  static const info = Color(0xFF0754B8);
}

/// Paleta de um nível de gravidade ou status (base, fundo do badge e texto acessível).
final class AcTonePalette {
  const AcTonePalette({required this.label, required this.base, required this.marker, required this.bg, required this.fg});
  final String label;
  final Color base;
  final Color marker;
  final Color bg;
  final Color fg;
}

abstract final class AcSeverityColors {
  static const low = AcTonePalette(label: 'Baixa', base: Color(0xFF16A34A), marker: Color(0xFF16A34A), bg: Color(0xFFDCFCE7), fg: Color(0xFF166534));
  static const moderate = AcTonePalette(label: 'Moderada', base: Color(0xFFF59E0B), marker: Color(0xFFD97706), bg: Color(0xFFFEF3C7), fg: Color(0xFF92400E));
  static const high = AcTonePalette(label: 'Alta', base: Color(0xFFEF4444), marker: Color(0xFFDC2626), bg: Color(0xFFFEE2E2), fg: Color(0xFFB91C1C));
  static const critical = AcTonePalette(label: 'Crítica', base: Color(0xFF991B1B), marker: Color(0xFF991B1B), bg: Color(0xFF991B1B), fg: Color(0xFFFFFFFF));
  /// Busca pelo valor do enum da API (ex.: 'LOW').
  static const byApiValue = <String, AcTonePalette>{
    'LOW': low,
    'MODERATE': moderate,
    'HIGH': high,
    'CRITICAL': critical,
  };
}

abstract final class AcStatusColors {
  static const pending = AcTonePalette(label: 'Pendente', base: Color(0xFFEAB308), marker: Color(0xFFEAB308), bg: Color(0xFFFEF9C3), fg: Color(0xFF854D0E));
  static const underReview = AcTonePalette(label: 'Em análise', base: Color(0xFF0754B8), marker: Color(0xFF0754B8), bg: Color(0xFFE8F2FF), fg: Color(0xFF063B82));
  static const validated = AcTonePalette(label: 'Validada', base: Color(0xFF0E7490), marker: Color(0xFF0E7490), bg: Color(0xFFCFFAFE), fg: Color(0xFF155E75));
  static const rejected = AcTonePalette(label: 'Rejeitada', base: Color(0xFF667085), marker: Color(0xFF667085), bg: Color(0xFFF2F4F7), fg: Color(0xFF344054));
  static const resolved = AcTonePalette(label: 'Resolvida', base: Color(0xFF15803D), marker: Color(0xFF15803D), bg: Color(0xFFDCFCE7), fg: Color(0xFF14532D));
  /// Busca pelo valor do enum da API (ex.: 'PENDING').
  static const byApiValue = <String, AcTonePalette>{
    'PENDING': pending,
    'UNDER_REVIEW': underReview,
    'VALIDATED': validated,
    'REJECTED': rejected,
    'RESOLVED': resolved,
  };
}

abstract final class AcSpacing {
  static const double xxs = 2;
  static const double xs = 4;
  static const double sm = 8;
  static const double md = 12;
  static const double lg = 16;
  static const double xl = 24;
  static const double xxl = 32;
  static const double xxxl = 48;
}

abstract final class AcRadius {
  static const double sm = 8;
  static const double md = 12;
  static const double lg = 16;
  static const double xl = 24;
  static const double pill = 999;
}

/// Escala tipográfica (tamanho, altura de linha em px e peso).
abstract final class AcTypeScale {
  static const fontFamily = 'Inter';
  static const kpi = TextStyle(fontFamily: fontFamily, fontSize: 32, height: 1.2500, fontWeight: FontWeight.w700);
  static const headline = TextStyle(fontFamily: fontFamily, fontSize: 26, height: 1.3077, fontWeight: FontWeight.w700);
  static const title = TextStyle(fontFamily: fontFamily, fontSize: 20, height: 1.4000, fontWeight: FontWeight.w600);
  static const subtitle = TextStyle(fontFamily: fontFamily, fontSize: 16, height: 1.5000, fontWeight: FontWeight.w600);
  static const body = TextStyle(fontFamily: fontFamily, fontSize: 15, height: 1.4667, fontWeight: FontWeight.w400);
  static const bodyStrong = TextStyle(fontFamily: fontFamily, fontSize: 15, height: 1.4667, fontWeight: FontWeight.w600);
  static const label = TextStyle(fontFamily: fontFamily, fontSize: 14, height: 1.4286, fontWeight: FontWeight.w500);
  static const caption = TextStyle(fontFamily: fontFamily, fontSize: 12, height: 1.3333, fontWeight: FontWeight.w500);
}

abstract final class AcMotion {
  static const fast = Duration(milliseconds: 120);
  static const base = Duration(milliseconds: 200);
  static const slow = Duration(milliseconds: 320);
}

/// Elevação (mesmos valores das sombras --ac-shadow-* do painel).
abstract final class AcElevation {
  static const card = <BoxShadow>[BoxShadow(offset: Offset(0, 1), blurRadius: 2, spreadRadius: 0, color: Color(0x0F101828)), BoxShadow(offset: Offset(0, 1), blurRadius: 3, spreadRadius: 0, color: Color(0x1A101828))];
  static const raised = <BoxShadow>[BoxShadow(offset: Offset(0, 4), blurRadius: 8, spreadRadius: -2, color: Color(0x1A101828)), BoxShadow(offset: Offset(0, 2), blurRadius: 4, spreadRadius: -2, color: Color(0x0F101828))];
  static const overlay = <BoxShadow>[BoxShadow(offset: Offset(0, 12), blurRadius: 16, spreadRadius: -4, color: Color(0x1F101828)), BoxShadow(offset: Offset(0, 4), blurRadius: 6, spreadRadius: -2, color: Color(0x0D101828))];
}

abstract final class AcLayout {
  static const double minTouchTarget = 48;
  static const double screenGutter = 16;
  static const double adminSidebarWidth = 248;
  static const double adminContentMaxWidth = 1440;
}
