import 'package:material_ui/material_ui.dart';

import '../../core/theme/app_tokens.g.dart';
import '../../core/utils/formatters.dart';
import '../../core/widgets/common.dart';
import '../../core/widgets/tones.dart';
import '../../data/occurrences_repository.dart';
import '../../domain/models.dart';
import 'map_page.dart' show periodLabel;

enum FilterSection { severity, status, distance, period }

const radiusOptions = [1000, 2000, 5000, 10000, 20000];
const periodOptions = [6, 24, 72, 168];

/// Folha de filtros avançados. Retorna os novos filtros ou `null` se cancelada.
Future<OccurrenceFilters?> showFiltersSheet(BuildContext context, OccurrenceFilters current, {FilterSection? focus}) {
  return showModalBottomSheet<OccurrenceFilters>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    useSafeArea: true,
    builder: (_) => _FiltersSheet(initial: current),
  );
}

class _FiltersSheet extends StatefulWidget {
  const _FiltersSheet({required this.initial});

  final OccurrenceFilters initial;

  @override
  State<_FiltersSheet> createState() => _FiltersSheetState();
}

class _FiltersSheetState extends State<_FiltersSheet> {
  late OccurrenceFilters f = widget.initial;

  @override
  Widget build(BuildContext context) {
    Widget title(String text) => Padding(
          padding: const EdgeInsets.only(top: AcSpacing.lg, bottom: AcSpacing.sm),
          child: Semantics(header: true, child: Text(text, style: AcTypeScale.subtitle)),
        );

    return Padding(
      padding: const EdgeInsets.fromLTRB(AcSpacing.lg, 0, AcSpacing.lg, AcSpacing.lg),
      child: SingleChildScrollView(
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          mainAxisSize: MainAxisSize.min,
          children: [
            Text('Filtros', style: AcTypeScale.title),
            title('Gravidade'),
            Wrap(spacing: AcSpacing.sm, runSpacing: AcSpacing.sm, children: [
              for (final s in Severity.values)
                AcFilterChip(
                  label: s.label,
                  icon: Icons.circle,
                  color: s.palette.marker,
                  selected: f.severities.contains(s),
                  onSelected: (on) => setState(() => f = f.copyWith(severities: on ? {...f.severities, s} : ({...f.severities}..remove(s)))),
                ),
            ]),
            title('Status'),
            Text('Sem seleção: pendentes, em análise e validadas.', style: AcTypeScale.caption.copyWith(color: AcColors.textSecondary)),
            const SizedBox(height: AcSpacing.sm),
            Wrap(spacing: AcSpacing.sm, runSpacing: AcSpacing.sm, children: [
              for (final s in OccurrenceStatus.values.where((s) => s != OccurrenceStatus.rejected))
                AcFilterChip(
                  label: s.label,
                  icon: s.icon,
                  color: s.palette.fg,
                  selected: f.statuses.contains(s),
                  onSelected: (on) => setState(() => f = f.copyWith(statuses: on ? {...f.statuses, s} : ({...f.statuses}..remove(s)))),
                ),
            ]),
            title('Distância'),
            Wrap(spacing: AcSpacing.sm, runSpacing: AcSpacing.sm, children: [
              for (final r in radiusOptions)
                AcFilterChip(
                  label: 'Até ${Formatters.distance(r)}',
                  selected: f.radiusMeters == r,
                  onSelected: (_) => setState(() => f = f.copyWith(radiusMeters: r)),
                ),
            ]),
            title('Período'),
            Wrap(spacing: AcSpacing.sm, runSpacing: AcSpacing.sm, children: [
              AcFilterChip(label: 'Qualquer', selected: f.periodHours == null, onSelected: (_) => setState(() => f = f.copyWith(periodHours: () => null))),
              for (final h in periodOptions)
                AcFilterChip(label: periodLabel(h), selected: f.periodHours == h, onSelected: (_) => setState(() => f = f.copyWith(periodHours: () => h))),
            ]),
            const SizedBox(height: AcSpacing.xl),
            Row(children: [
              Expanded(
                child: OutlinedButton(
                  onPressed: () => setState(() => f = OccurrenceFilters(query: f.query)),
                  child: const Text('Limpar'),
                ),
              ),
              const SizedBox(width: AcSpacing.md),
              Expanded(child: FilledButton(onPressed: () => Navigator.pop(context, f), child: const Text('Aplicar'))),
            ]),
          ],
        ),
      ),
    );
  }
}
