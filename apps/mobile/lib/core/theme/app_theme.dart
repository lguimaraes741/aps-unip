import 'package:material_ui/material_ui.dart';

import 'app_tokens.g.dart';

/// Tema Material 3 construído exclusivamente a partir dos tokens do design system.
abstract final class AppTheme {
  static ThemeData light() {
    final scheme = ColorScheme.fromSeed(
      seedColor: AcColors.primary,
      primary: AcColors.primary,
      onPrimary: AcColors.onPrimary,
      primaryContainer: AcColors.primaryLight,
      onPrimaryContainer: AcColors.primaryDark,
      surface: AcColors.surface,
      onSurface: AcColors.textPrimary,
      onSurfaceVariant: AcColors.textSecondary,
      outline: AcColors.borderStrong,
      outlineVariant: AcColors.border,
      error: AcColors.error,
    );

    final textTheme = TextTheme(
      displaySmall: AcTypeScale.kpi,
      headlineSmall: AcTypeScale.headline,
      titleLarge: AcTypeScale.title,
      titleMedium: AcTypeScale.subtitle,
      bodyLarge: AcTypeScale.body,
      bodyMedium: AcTypeScale.body,
      labelLarge: AcTypeScale.label,
      labelMedium: AcTypeScale.label,
      bodySmall: AcTypeScale.caption,
      labelSmall: AcTypeScale.caption,
    ).apply(bodyColor: AcColors.textPrimary, displayColor: AcColors.textPrimary);

    final radius = BorderRadius.circular(AcRadius.md);
    const minTouch = Size(AcLayout.minTouchTarget, AcLayout.minTouchTarget);

    return ThemeData(
      useMaterial3: true,
      colorScheme: scheme,
      fontFamily: AcTypeScale.fontFamily,
      textTheme: textTheme,
      scaffoldBackgroundColor: AcColors.background,
      materialTapTargetSize: MaterialTapTargetSize.padded,
      appBarTheme: AppBarTheme(
        backgroundColor: AcColors.surface,
        foregroundColor: AcColors.textPrimary,
        elevation: 0,
        scrolledUnderElevation: 1,
        centerTitle: false,
        titleTextStyle: AcTypeScale.title.copyWith(color: AcColors.textPrimary),
      ),
      cardTheme: CardThemeData(
        color: AcColors.surface,
        elevation: 0,
        margin: EdgeInsets.zero,
        shape: RoundedRectangleBorder(
          borderRadius: radius,
          side: const BorderSide(color: AcColors.border),
        ),
      ),
      filledButtonTheme: FilledButtonThemeData(
        style: FilledButton.styleFrom(
          minimumSize: const Size.fromHeight(AcLayout.minTouchTarget + 4),
          textStyle: AcTypeScale.bodyStrong,
          shape: RoundedRectangleBorder(borderRadius: radius),
        ),
      ),
      outlinedButtonTheme: OutlinedButtonThemeData(
        style: OutlinedButton.styleFrom(
          minimumSize: const Size.fromHeight(AcLayout.minTouchTarget + 4),
          textStyle: AcTypeScale.bodyStrong,
          side: const BorderSide(color: AcColors.borderStrong),
          shape: RoundedRectangleBorder(borderRadius: radius),
        ),
      ),
      textButtonTheme: TextButtonThemeData(style: TextButton.styleFrom(minimumSize: minTouch)),
      inputDecorationTheme: InputDecorationTheme(
        filled: true,
        fillColor: AcColors.surface,
        contentPadding: const EdgeInsets.symmetric(horizontal: AcSpacing.lg, vertical: AcSpacing.md + 2),
        border: OutlineInputBorder(borderRadius: radius, borderSide: const BorderSide(color: AcColors.border)),
        enabledBorder: OutlineInputBorder(borderRadius: radius, borderSide: const BorderSide(color: AcColors.border)),
        focusedBorder: OutlineInputBorder(
          borderRadius: radius,
          borderSide: const BorderSide(color: AcColors.primary, width: 2),
        ),
        errorBorder: OutlineInputBorder(borderRadius: radius, borderSide: const BorderSide(color: AcColors.error)),
        labelStyle: AcTypeScale.label.copyWith(color: AcColors.textSecondary),
        hintStyle: AcTypeScale.body.copyWith(color: AcColors.textDisabled),
        errorStyle: AcTypeScale.caption.copyWith(color: AcColors.error),
      ),
      chipTheme: ChipThemeData(
        backgroundColor: AcColors.surface,
        selectedColor: AcColors.primaryLight,
        side: const BorderSide(color: AcColors.border),
        labelStyle: AcTypeScale.label.copyWith(color: AcColors.textPrimary),
        shape: RoundedRectangleBorder(borderRadius: BorderRadius.circular(AcRadius.pill)),
        showCheckmark: false,
      ),
      navigationBarTheme: NavigationBarThemeData(
        backgroundColor: AcColors.surface,
        indicatorColor: AcColors.primaryLight,
        elevation: 2,
        labelTextStyle: WidgetStatePropertyAll(AcTypeScale.caption.copyWith(color: AcColors.textPrimary)),
      ),
      floatingActionButtonTheme: const FloatingActionButtonThemeData(
        backgroundColor: AcColors.primary,
        foregroundColor: AcColors.onPrimary,
      ),
      snackBarTheme: SnackBarThemeData(
        behavior: SnackBarBehavior.floating,
        shape: RoundedRectangleBorder(borderRadius: radius),
      ),
      dividerTheme: const DividerThemeData(color: AcColors.border, space: 1),
    );
  }
}
