import 'package:material_ui/material_ui.dart';

import '../../domain/models.dart';
import '../theme/app_tokens.g.dart';
import '../utils/formatters.dart';
import 'tones.dart';

/// Logotipo: gota estilizada sobre um marcador de mapa.
class AppLogo extends StatelessWidget {
  const AppLogo({super.key, this.size = 40, this.onDark = false, this.showName = true});

  final double size;
  final bool onDark;
  final bool showName;

  @override
  Widget build(BuildContext context) {
    final mark = Container(
      width: size,
      height: size,
      decoration: BoxDecoration(
        color: onDark ? AcColors.onPrimary : AcColors.primary,
        borderRadius: BorderRadius.circular(size * 0.28),
      ),
      child: Stack(
        alignment: Alignment.center,
        children: [
          Icon(Icons.location_on, size: size * 0.72, color: onDark ? AcColors.primary : AcColors.onPrimary),
          Positioned(
            top: size * 0.2,
            child: Icon(Icons.water_drop, size: size * 0.28, color: onDark ? AcColors.onPrimary : AcColors.primary),
          ),
        ],
      ),
    );
    if (!showName) return Semantics(label: 'AlertaCidade', child: mark);
    return Semantics(
      label: 'AlertaCidade',
      excludeSemantics: true,
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          mark,
          SizedBox(width: size * 0.25),
          Text(
            'AlertaCidade',
            style: AcTypeScale.title.copyWith(
              fontSize: size * 0.5,
              color: onDark ? AcColors.onPrimary : AcColors.textPrimary,
              fontWeight: FontWeight.w700,
            ),
          ),
        ],
      ),
    );
  }
}

/// Seção de formulário/detalhe com título e card.
class SectionCard extends StatelessWidget {
  const SectionCard({super.key, required this.title, required this.child, this.step, this.trailing});

  final String title;
  final Widget child;
  final int? step;
  final Widget? trailing;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(AcSpacing.lg),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Row(
              children: [
                if (step != null) ...[
                  CircleAvatar(
                    radius: 12,
                    backgroundColor: AcColors.primary,
                    child: Text('$step', style: AcTypeScale.caption.copyWith(color: AcColors.onPrimary, fontWeight: FontWeight.w700)),
                  ),
                  const SizedBox(width: AcSpacing.sm),
                ],
                Expanded(child: Semantics(header: true, child: Text(title, style: AcTypeScale.subtitle))),
                ?trailing,
              ],
            ),
            const SizedBox(height: AcSpacing.md),
            child,
          ],
        ),
      ),
    );
  }
}

/// Card de indicador numérico (Meus registros, dashboard).
class MetricCard extends StatelessWidget {
  const MetricCard({super.key, required this.label, required this.value, required this.icon, this.color = AcColors.primary});

  final String label;
  final int? value;
  final IconData icon;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: '$label: ${value ?? 'carregando'}',
      excludeSemantics: true,
      child: Card(
        child: Padding(
          padding: const EdgeInsets.all(AcSpacing.md),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(icon, color: color, size: 20),
              const SizedBox(height: AcSpacing.sm),
              Text(value?.toString() ?? '–', style: AcTypeScale.kpi.copyWith(fontSize: 26, height: 1.1)),
              Text(label, style: AcTypeScale.caption.copyWith(color: AcColors.textSecondary), maxLines: 1, overflow: TextOverflow.ellipsis),
            ],
          ),
        ),
      ),
    );
  }
}

/// Chip de filtro com estado selecionado.
class AcFilterChip extends StatelessWidget {
  const AcFilterChip({super.key, required this.label, required this.selected, required this.onSelected, this.icon, this.color});

  final String label;
  final bool selected;
  final ValueChanged<bool> onSelected;
  final IconData? icon;
  final Color? color;

  @override
  Widget build(BuildContext context) {
    return FilterChip(
      label: Text(label),
      selected: selected,
      onSelected: onSelected,
      avatar: icon == null ? null : Icon(icon, size: 16, color: color ?? AcColors.textSecondary),
      side: BorderSide(color: selected ? AcColors.primary : AcColors.border),
      labelStyle: AcTypeScale.label.copyWith(color: selected ? AcColors.primaryDark : AcColors.textPrimary),
    );
  }
}

/// Marcador de ocorrência no mapa: cor = gravidade; registros resolvidos ficam
/// esmaecidos e com ícone de concluído (status não se confunde com gravidade).
class OccurrenceMarker extends StatelessWidget {
  const OccurrenceMarker({super.key, required this.severity, required this.status, this.selected = false});

  final Severity severity;
  final OccurrenceStatus status;
  final bool selected;

  @override
  Widget build(BuildContext context) {
    final resolved = status == OccurrenceStatus.resolved;
    final color = severity.palette.marker;
    return Semantics(
      label: 'Ocorrência de gravidade ${severity.label}, ${status.label}',
      child: AnimatedScale(
        scale: selected ? 1.25 : 1,
        duration: AcMotion.fast,
        alignment: Alignment.bottomCenter,
        child: Opacity(
          opacity: resolved ? 0.55 : 1,
          child: Stack(
            alignment: Alignment.topCenter,
            children: [
              Icon(Icons.location_on, size: 44, color: color, shadows: const [Shadow(blurRadius: 4, color: Color(0x55000000))]),
              Positioned(
                top: 8,
                child: Icon(resolved ? Icons.check : Icons.water_drop, size: 16, color: Colors.white),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Linha do tempo da ocorrência.
class StatusTimeline extends StatelessWidget {
  const StatusTimeline({super.key, required this.entries, required this.confirmCount});

  final List<TimelineEntry> entries;
  final int confirmCount;

  @override
  Widget build(BuildContext context) {
    final items = <({IconData icon, Color color, String title, String? subtitle, DateTime? at})>[];
    for (final e in entries) {
      final title = e.fromStatus == null ? 'Ocorrência registrada' : e.toStatus.label;
      items.add((
        icon: e.fromStatus == null ? Icons.add_location_alt_outlined : e.toStatus.icon,
        color: e.toStatus.palette.fg,
        title: e.fromStatus == null ? title : '$title${e.byModeration ? ' pela moderação' : ''}',
        subtitle: e.note,
        at: e.createdAt,
      ));
      if (e.fromStatus == null && confirmCount > 0) {
        items.add((
          icon: Icons.groups_outlined,
          color: AcColors.primary,
          title: '$confirmCount ${confirmCount == 1 ? 'confirmação recebida' : 'confirmações recebidas'}',
          subtitle: null,
          at: null,
        ));
      }
    }
    return Column(
      children: [
        for (var i = 0; i < items.length; i++)
          IntrinsicHeight(
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Column(
                  children: [
                    CircleAvatar(radius: 14, backgroundColor: items[i].color.withValues(alpha: 0.12), child: Icon(items[i].icon, size: 16, color: items[i].color)),
                    if (i < items.length - 1) Expanded(child: Container(width: 2, color: AcColors.border)),
                  ],
                ),
                const SizedBox(width: AcSpacing.md),
                Expanded(
                  child: Padding(
                    padding: const EdgeInsets.only(bottom: AcSpacing.lg, top: 4),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(items[i].title, style: AcTypeScale.bodyStrong),
                        if (items[i].at != null)
                          Text(Formatters.dateTime(items[i].at!), style: AcTypeScale.caption.copyWith(color: AcColors.textSecondary)),
                        if (items[i].subtitle != null)
                          Padding(
                            padding: const EdgeInsets.only(top: AcSpacing.xs),
                            child: Text(items[i].subtitle!, style: AcTypeScale.body),
                          ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
      ],
    );
  }
}

Future<bool> showConfirmationDialog(
  BuildContext context, {
  required String title,
  required String message,
  required String confirmLabel,
  bool destructive = false,
}) async {
  final result = await showDialog<bool>(
    context: context,
    builder: (context) => AlertDialog(
      title: Text(title),
      content: Text(message),
      actions: [
        TextButton(onPressed: () => Navigator.pop(context, false), child: const Text('Cancelar')),
        FilledButton(
          style: destructive ? FilledButton.styleFrom(backgroundColor: AcColors.error, minimumSize: const Size(0, 44)) : FilledButton.styleFrom(minimumSize: const Size(0, 44)),
          onPressed: () => Navigator.pop(context, true),
          child: Text(confirmLabel),
        ),
      ],
    ),
  );
  return result ?? false;
}

enum SnackKind { success, error, info }

void showAppSnackbar(BuildContext context, String message, {SnackKind kind = SnackKind.info}) {
  final (icon, color) = switch (kind) {
    SnackKind.success => (Icons.check_circle, AcColors.success),
    SnackKind.error => (Icons.error, AcColors.error),
    SnackKind.info => (Icons.info, AcColors.primaryDark),
  };
  ScaffoldMessenger.of(context)
    ..hideCurrentSnackBar()
    ..showSnackBar(SnackBar(
      backgroundColor: color,
      content: Row(children: [
        Icon(icon, color: Colors.white),
        const SizedBox(width: AcSpacing.sm),
        Expanded(child: Text(message, style: AcTypeScale.body.copyWith(color: Colors.white))),
      ]),
    ));
}
