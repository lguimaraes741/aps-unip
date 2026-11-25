import 'package:material_ui/material_ui.dart';

import '../../core/theme/app_tokens.g.dart';
import '../../core/utils/formatters.dart';
import '../../core/utils/share.dart';
import '../../core/widgets/badges.dart';
import '../../core/widgets/buttons.dart';
import '../../core/widgets/tones.dart';
import '../../domain/models.dart';

/// Resumo flutuante ao tocar num marcador (Fluxo A: marcador → resumo → detalhes).
/// Faixa superior na cor da gravidade (paleta acessível bg/fg do design system).
class MapSummaryCard extends StatelessWidget {
  const MapSummaryCard({super.key, required this.occurrence, required this.onOpen, required this.onClose});

  final OccurrenceSummary occurrence;
  final VoidCallback onOpen;
  final VoidCallback onClose;

  @override
  Widget build(BuildContext context) {
    final o = occurrence;
    final palette = o.severity.palette;
    final place = [o.neighborhood, if (o.distanceMeters != null) Formatters.distance(o.distanceMeters!)].whereType<String>().join(' · ');
    final updated = o.updatedAt.isAfter(o.createdAt.add(const Duration(seconds: 5))) ? o.updatedAt : o.createdAt;

    // Sombra numa camada externa com fundo branco (dentro de um card transparente ela escurece o conteúdo).
    return DecoratedBox(
      decoration: BoxDecoration(color: AcColors.surface, borderRadius: BorderRadius.circular(AcRadius.xl), boxShadow: AcElevation.overlay),
      child: Material(
        color: AcColors.surface,
        borderRadius: BorderRadius.circular(AcRadius.xl),
        clipBehavior: Clip.antiAlias,
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.stretch,
          children: [
            Container(
              color: palette.bg,
              padding: const EdgeInsets.fromLTRB(AcSpacing.lg, AcSpacing.sm, AcSpacing.xs, AcSpacing.sm),
              child: Row(
                children: [
                  Icon(o.severity.icon, size: 18, color: palette.fg),
                  const SizedBox(width: AcSpacing.sm),
                  Expanded(
                    child: Text(
                      'Gravidade ${o.severity.label.toLowerCase()} · atualizada ${Formatters.relative(updated)}',
                      style: AcTypeScale.caption.copyWith(color: palette.fg, fontWeight: FontWeight.w600),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                    ),
                  ),
                  IconButton(
                    tooltip: 'Fechar resumo',
                    onPressed: onClose,
                    icon: Icon(Icons.close, color: palette.fg, size: 20),
                  ),
                ],
              ),
            ),
            InkWell(
              onTap: onOpen,
              child: Padding(
                padding: const EdgeInsets.fromLTRB(AcSpacing.lg, AcSpacing.md, AcSpacing.lg, AcSpacing.sm),
                child: Column(
                  crossAxisAlignment: CrossAxisAlignment.start,
                  children: [
                    Text(o.title, style: AcTypeScale.subtitle, maxLines: 2, overflow: TextOverflow.ellipsis),
                    const SizedBox(height: AcSpacing.xxs),
                    Row(
                      children: [
                        const Icon(Icons.place_outlined, size: 16, color: AcColors.textSecondary),
                        const SizedBox(width: AcSpacing.xs),
                        Expanded(
                          child: Text(
                            place.isEmpty ? o.address : place,
                            style: AcTypeScale.label.copyWith(color: AcColors.textSecondary),
                            maxLines: 1,
                            overflow: TextOverflow.ellipsis,
                          ),
                        ),
                      ],
                    ),
                    const SizedBox(height: AcSpacing.sm),
                    Wrap(
                      spacing: AcSpacing.xs,
                      runSpacing: AcSpacing.xs,
                      children: [StatusBadge(o.status), if (o.isDemo) const DemoBadge()],
                    ),
                  ],
                ),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(AcSpacing.md, 0, AcSpacing.md, AcSpacing.md),
              child: Row(
                children: [
                  PillButton(
                    label: 'Compartilhar',
                    icon: Icons.share_outlined,
                    onPressed: () => shareOccurrence(
                      code: o.code,
                      title: o.title,
                      severity: o.severity,
                      status: o.status,
                      address: o.address,
                      neighborhood: o.neighborhood,
                      createdAt: o.createdAt,
                      latitude: o.latitude,
                      longitude: o.longitude,
                    ),
                  ),
                  const Spacer(),
                  FilledButton.icon(
                    onPressed: onOpen,
                    style: FilledButton.styleFrom(minimumSize: const Size(0, 44), shape: const StadiumBorder()),
                    icon: const Icon(Icons.arrow_forward, size: 18),
                    label: const Text('Ver detalhes'),
                  ),
                ],
              ),
            ),
          ],
        ),
      ),
    );
  }
}
