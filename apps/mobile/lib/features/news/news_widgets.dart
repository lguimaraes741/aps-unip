import 'package:material_ui/material_ui.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/theme/app_tokens.g.dart';
import '../../core/utils/formatters.dart';
import '../../core/widgets/common.dart';
import '../../core/widgets/tones.dart';
import '../../domain/models.dart';
import '../../domain/news.dart';

/// Cores de um alerta de notícia: as da gravidade ou, sem gravidade informada, cinza neutro
/// (ausência de informação nunca é pintada como "baixa").
({Color marker, Color bg, Color fg, Color header}) newsTone(Severity? severity) => severity == null
    ? (marker: AcColors.textSecondary, bg: AcColors.surfaceMuted, fg: AcColors.textSecondary, header: AcColors.textSecondary)
    : (marker: severity.palette.marker, bg: severity.palette.bg, fg: severity.palette.fg, header: severity.headerColor);

String newsSeverityLabel(Severity? severity) => severity == null ? 'Gravidade não informada' : 'Gravidade ${severity.label.toLowerCase()}';

/// Jornal = notícia; prédio público = comunicado oficial (relato do cidadão é a "bolha" redonda).
IconData newsIcon(NewsAlert alert) => alert.isOfficial ? Icons.account_balance : Icons.newspaper;

/// De onde vem a informação — sempre dito ao usuário, nunca apresentado como Defesa Civil sem ser.
String newsOriginText(NewsAlert a) {
  if (a.isOfficial) return 'Comunicado oficial${a.primarySource == null ? '' : ' publicado por ${a.primarySource!.name}'}.';
  if (a.level == NewsAlertLevel.verified) {
    final how = a.independentSources >= 2 ? 'Confirmado por ${a.independentSources} fontes independentes' : 'Conferido pela moderação';
    return '$how. Não é comunicado oficial.';
  }
  return 'Notícia ainda não confirmada. Não é comunicado oficial.';
}

/// "G1 (+1)".
String newsSourcesLabel(NewsAlert a) {
  final name = a.primarySource?.name ?? 'Fonte não informada';
  final others = a.sourceCount - 1;
  return others > 0 ? '$name (+$others)' : name;
}

Future<void> openOriginalNews(BuildContext context, String? url) async {
  final uri = url == null ? null : Uri.tryParse(url);
  // Só http(s) (a API já filtra; defesa extra contra esquemas que abririam outros apps).
  if (uri == null || !(uri.scheme == 'https' || uri.scheme == 'http')) {
    showAppSnackbar(context, 'Link da notícia indisponível.', kind: SnackKind.error);
    return;
  }
  if (!await launchUrl(uri, mode: LaunchMode.externalApplication) && context.mounted) {
    showAppSnackbar(context, 'Não foi possível abrir o navegador.', kind: SnackKind.error);
  }
}

/// Marcador de notícia: quadrado arredondado (formato diferente da bolha redonda dos relatos),
/// ícone de jornal ou de órgão oficial, borda na cor da gravidade (tracejado visual = cinza).
class NewsMarker extends StatelessWidget {
  const NewsMarker({super.key, required this.alert, this.selected = false, this.compact = false});

  static const double size = 40;

  final NewsAlert alert;
  final bool selected;

  /// Rótulo de alerta regional (menor, no centro da área).
  final bool compact;

  @override
  Widget build(BuildContext context) {
    final tone = newsTone(alert.severity);
    final s = compact ? size - 6 : size;
    return Semantics(
      button: true,
      label: 'Alerta de notícia, ${newsSeverityLabel(alert.severity).toLowerCase()}, ${alert.level.label.toLowerCase()}, ${alert.placeLabel}',
      excludeSemantics: true,
      child: AnimatedScale(
        scale: selected ? 1.2 : 1,
        duration: AcMotion.base,
        curve: Curves.easeOutBack,
        child: Container(
          width: s,
          height: s,
          decoration: BoxDecoration(
            color: AcColors.surface,
            borderRadius: BorderRadius.circular(AcRadius.sm),
            border: Border.all(color: tone.marker, width: selected ? 4 : 3),
            boxShadow: AcElevation.raised,
          ),
          child: Icon(newsIcon(alert), size: compact ? 18 : 20, color: tone.marker),
        ),
      ),
    );
  }
}

/// Pílula do nível de verificação.
class NewsLevelBadge extends StatelessWidget {
  const NewsLevelBadge(this.level, {super.key});

  final NewsAlertLevel level;

  @override
  Widget build(BuildContext context) {
    final (bg, fg, icon) = switch (level) {
      NewsAlertLevel.preliminary => (AcStatusColors.pending.bg, AcStatusColors.pending.fg, Icons.help_outline),
      NewsAlertLevel.verified => (AcStatusColors.validated.bg, AcStatusColors.validated.fg, Icons.verified_outlined),
      NewsAlertLevel.official => (AcColors.primaryLight, AcColors.primaryDark, Icons.account_balance),
    };
    return _NewsPill(label: level.label, bg: bg, fg: fg, icon: icon, semantics: 'Verificação: ${level.label}');
  }
}

class NewsSeverityBadge extends StatelessWidget {
  const NewsSeverityBadge(this.severity, {super.key});

  final Severity? severity;

  @override
  Widget build(BuildContext context) {
    final tone = newsTone(severity);
    return _NewsPill(
      label: severity?.label ?? 'Não informada',
      bg: tone.bg,
      fg: tone.fg,
      icon: severity?.icon ?? Icons.remove_circle_outline,
      semantics: newsSeverityLabel(severity),
    );
  }
}

class _NewsPill extends StatelessWidget {
  const _NewsPill({required this.label, required this.bg, required this.fg, required this.icon, required this.semantics});

  final String label;
  final Color bg;
  final Color fg;
  final IconData icon;
  final String semantics;

  @override
  Widget build(BuildContext context) => Semantics(
        label: semantics,
        excludeSemantics: true,
        child: Container(
          padding: const EdgeInsets.symmetric(horizontal: AcSpacing.sm + 2, vertical: AcSpacing.xxs + 1),
          decoration: BoxDecoration(color: bg, borderRadius: BorderRadius.circular(AcRadius.pill), border: Border.all(color: fg.withValues(alpha: 0.25))),
          child: Row(mainAxisSize: MainAxisSize.min, children: [
            Icon(icon, size: 14, color: fg),
            const SizedBox(width: AcSpacing.xs),
            Text(label, style: AcTypeScale.caption.copyWith(color: fg, fontWeight: FontWeight.w600)),
          ]),
        ),
      );
}

/// Resumo flutuante ao tocar num alerta de notícia no mapa (wireframe 7.9).
class NewsSummaryCard extends StatelessWidget {
  const NewsSummaryCard({super.key, required this.alert, required this.onOpen, required this.onClose});

  final NewsAlert alert;
  final VoidCallback onOpen;
  final VoidCallback onClose;

  @override
  Widget build(BuildContext context) {
    final a = alert;
    final tone = newsTone(a.severity);
    final when = [
      if (a.eventOccurredAt != null) 'Ocorrido ${Formatters.relative(a.eventOccurredAt!)}',
      'atualizado ${Formatters.relative(a.lastEvidenceAt)}',
    ].join(' · ');

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
              color: tone.bg,
              padding: const EdgeInsets.fromLTRB(AcSpacing.lg, AcSpacing.sm, AcSpacing.xs, AcSpacing.sm),
              child: Row(children: [
                Icon(newsIcon(a), size: 18, color: tone.fg),
                const SizedBox(width: AcSpacing.sm),
                Expanded(
                  child: Text(
                    '${a.isOfficial ? 'Comunicado' : 'Notícia'} · ${newsSeverityLabel(a.severity)} · ${a.level.label}',
                    style: AcTypeScale.caption.copyWith(color: tone.fg, fontWeight: FontWeight.w600),
                    maxLines: 1,
                    overflow: TextOverflow.ellipsis,
                  ),
                ),
                IconButton(tooltip: 'Fechar resumo', onPressed: onClose, icon: Icon(Icons.close, color: tone.fg, size: 20)),
              ]),
            ),
            InkWell(
              onTap: onOpen,
              child: Padding(
                padding: const EdgeInsets.fromLTRB(AcSpacing.lg, AcSpacing.md, AcSpacing.lg, AcSpacing.sm),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Text(a.title, style: AcTypeScale.subtitle, maxLines: 2, overflow: TextOverflow.ellipsis),
                  const SizedBox(height: AcSpacing.xxs),
                  _InfoLine(
                    icon: Icons.place_outlined,
                    text: '${a.placeLabel} (abrangência: ${precisionLabel(a.locationPrecision)})'
                        '${a.distanceMeters != null && a.distanceMeters! > 0 ? ' · ${Formatters.distance(a.distanceMeters!)}' : ''}',
                  ),
                  _InfoLine(icon: Icons.schedule, text: when),
                  _InfoLine(icon: Icons.newspaper_outlined, text: 'Fonte: ${newsSourcesLabel(a)}'),
                  const SizedBox(height: AcSpacing.xs),
                  Text(newsOriginText(a), style: AcTypeScale.caption.copyWith(color: AcColors.textSecondary, fontStyle: FontStyle.italic)),
                ]),
              ),
            ),
            Padding(
              padding: const EdgeInsets.fromLTRB(AcSpacing.md, 0, AcSpacing.md, AcSpacing.md),
              child: Row(children: [
                Flexible(
                  child: OutlinedButton.icon(
                    onPressed: a.primarySource?.url == null ? null : () => openOriginalNews(context, a.primarySource!.url),
                    style: OutlinedButton.styleFrom(minimumSize: const Size(0, 44), shape: const StadiumBorder()),
                    icon: const Icon(Icons.open_in_new, size: 18),
                    label: const Text('Ver notícia original', overflow: TextOverflow.ellipsis),
                  ),
                ),
                const SizedBox(width: AcSpacing.sm),
                FilledButton.icon(
                  onPressed: onOpen,
                  style: FilledButton.styleFrom(minimumSize: const Size(0, 44), shape: const StadiumBorder()),
                  icon: const Icon(Icons.arrow_forward, size: 18),
                  label: const Text('Detalhes'),
                ),
              ]),
            ),
          ],
        ),
      ),
    );
  }
}

class _InfoLine extends StatelessWidget {
  const _InfoLine({required this.icon, required this.text});

  final IconData icon;
  final String text;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(top: AcSpacing.xxs),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Padding(padding: const EdgeInsets.only(top: 1), child: Icon(icon, size: 16, color: AcColors.textSecondary)),
          const SizedBox(width: AcSpacing.xs),
          Expanded(child: Text(text, style: AcTypeScale.label.copyWith(color: AcColors.textSecondary), maxLines: 2, overflow: TextOverflow.ellipsis)),
        ]),
      );
}
