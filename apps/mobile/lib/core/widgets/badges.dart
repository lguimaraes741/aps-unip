import 'package:material_ui/material_ui.dart';

import '../../domain/models.dart';
import '../theme/app_tokens.g.dart';
import 'tones.dart';

class _Pill extends StatelessWidget {
  const _Pill({required this.label, required this.bg, required this.fg, this.icon, this.border, this.semantics});

  final String label;
  final Color bg;
  final Color fg;
  final IconData? icon;
  final Color? border;
  final String? semantics;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: semantics ?? label,
      excludeSemantics: true,
      child: Container(
        padding: const EdgeInsets.symmetric(horizontal: AcSpacing.sm + 2, vertical: AcSpacing.xxs + 1),
        decoration: BoxDecoration(
          color: bg,
          borderRadius: BorderRadius.circular(AcRadius.pill),
          border: border == null ? null : Border.all(color: border!),
        ),
        child: Row(
          mainAxisSize: MainAxisSize.min,
          children: [
            if (icon != null) ...[Icon(icon, size: 14, color: fg), const SizedBox(width: AcSpacing.xs)],
            Text(label, style: AcTypeScale.caption.copyWith(color: fg, fontWeight: FontWeight.w600)),
          ],
        ),
      ),
    );
  }
}

/// Gravidade informada pelo cidadão (preenchido, com ponto colorido).
class SeverityBadge extends StatelessWidget {
  const SeverityBadge(this.severity, {super.key});

  final Severity severity;

  @override
  Widget build(BuildContext context) {
    final p = severity.palette;
    return _Pill(label: p.label, bg: p.bg, fg: p.fg, icon: severity.icon, semantics: 'Gravidade ${p.label}');
  }
}

/// Situação na moderação (pílula com ícone). Visualmente distinta da gravidade.
class StatusBadge extends StatelessWidget {
  const StatusBadge(this.status, {super.key});

  final OccurrenceStatus status;

  @override
  Widget build(BuildContext context) {
    final p = status.palette;
    return _Pill(label: p.label, bg: p.bg, fg: p.fg, icon: status.icon, border: p.fg.withValues(alpha: 0.25), semantics: 'Status ${p.label}');
  }
}

/// Selo para registros do seed de demonstração — nunca exibi-los como relatos reais.
class DemoBadge extends StatelessWidget {
  const DemoBadge({super.key});

  @override
  Widget build(BuildContext context) => const _Pill(
        label: 'Demonstração',
        bg: AcColors.surfaceMuted,
        fg: AcColors.textSecondary,
        icon: Icons.science_outlined,
        border: AcColors.border,
        semantics: 'Registro de demonstração',
      );
}
