import 'package:material_ui/material_ui.dart';

import '../../domain/models.dart';
import '../config/app_config.dart';
import '../theme/app_tokens.g.dart';
import '../utils/formatters.dart';
import 'badges.dart';
import 'tones.dart';

/// Card de ocorrência com barra lateral na cor da gravidade.
/// Usado na lista do mapa (compacto) e em "Meus registros".
class OccurrenceCard extends StatelessWidget {
  const OccurrenceCard({super.key, required this.occurrence, required this.onTap, this.selected = false, this.showUpdatedAt = false});

  final OccurrenceSummary occurrence;
  final VoidCallback onTap;
  final bool selected;
  final bool showUpdatedAt;

  @override
  Widget build(BuildContext context) {
    final o = occurrence;
    final location = [o.neighborhood, if (o.distanceMeters != null) Formatters.distance(o.distanceMeters!)]
        .whereType<String>()
        .join(' · ');
    return Semantics(
      button: true,
      label: '${o.title}. Gravidade ${o.severity.label}. Status ${o.status.label}. $location',
      child: AnimatedContainer(
        duration: AcMotion.base,
        decoration: BoxDecoration(
          color: AcColors.surface,
          borderRadius: BorderRadius.circular(AcRadius.lg),
          border: Border.all(color: selected ? AcColors.primary : AcColors.border, width: selected ? 2 : 1),
          boxShadow: AcElevation.card,
        ),
        clipBehavior: Clip.antiAlias,
        child: InkWell(
          onTap: onTap,
          child: IntrinsicHeight(
            child: Row(
              crossAxisAlignment: CrossAxisAlignment.stretch,
              children: [
                Container(width: 5, color: o.severity.palette.marker),
                // Alinhada ao topo: a miniatura não estica com a altura do card.
                Padding(
                  padding: const EdgeInsets.all(AcSpacing.md),
                  child: Align(alignment: Alignment.topCenter, child: _Thumbnail(url: o.coverPhotoUrl, severity: o.severity)),
                ),
                Expanded(
                  child: Padding(
                    padding: const EdgeInsets.fromLTRB(0, AcSpacing.md, AcSpacing.md, AcSpacing.md),
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text(o.title, style: AcTypeScale.bodyStrong, maxLines: 2, overflow: TextOverflow.ellipsis),
                        const SizedBox(height: AcSpacing.xxs),
                        Text(
                          location.isEmpty ? o.address : location,
                          style: AcTypeScale.caption.copyWith(color: AcColors.textSecondary),
                          maxLines: 1,
                          overflow: TextOverflow.ellipsis,
                        ),
                        const SizedBox(height: AcSpacing.sm),
                        Wrap(
                          spacing: AcSpacing.xs,
                          runSpacing: AcSpacing.xs,
                          crossAxisAlignment: WrapCrossAlignment.center,
                          children: [SeverityBadge(o.severity), StatusBadge(o.status)],
                        ),
                        const SizedBox(height: AcSpacing.xs),
                        // Selo de demonstração na linha do horário: sempre visível, sem ocupar uma linha só.
                        Row(
                          children: [
                            Flexible(
                              child: Text(
                                showUpdatedAt && o.updatedAt.isAfter(o.createdAt.add(const Duration(seconds: 5)))
                                    ? 'Atualizada ${Formatters.relative(o.updatedAt)}'
                                    : Formatters.relative(o.createdAt),
                                style: AcTypeScale.caption.copyWith(color: AcColors.textSecondary),
                              ),
                            ),
                            if (o.isDemo) ...[const SizedBox(width: AcSpacing.sm), const DemoBadge()],
                          ],
                        ),
                      ],
                    ),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}

class _Thumbnail extends StatelessWidget {
  const _Thumbnail({required this.url, required this.severity});

  final String? url;
  final Severity severity;

  @override
  Widget build(BuildContext context) {
    final placeholder = Container(
      color: severity.palette.bg,
      child: Icon(severity.icon, color: severity.palette.fg),
    );
    return ClipRRect(
      borderRadius: BorderRadius.circular(AcRadius.sm),
      child: SizedBox(
        width: 64,
        height: 64,
        child: url == null
            ? placeholder
            : Image.network(
                AppConfig.absoluteUrl(url!),
                fit: BoxFit.cover,
                cacheWidth: 192,
                errorBuilder: (_, _, _) => placeholder,
              ),
      ),
    );
  }
}
