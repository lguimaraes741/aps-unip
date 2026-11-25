import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../../core/theme/app_tokens.g.dart';
import '../../core/utils/formatters.dart';
import '../../core/widgets/common.dart';
import '../../core/widgets/states.dart';
import '../../domain/news.dart';
import 'news_state.dart';
import 'news_widgets.dart';

/// Detalhes de um alerta de notícia: situação, local, todas as fontes e de onde vem a informação.
/// Também abre alerta retirado (destino do aviso de correção), mostrando o motivo.
class NewsDetailPage extends ConsumerWidget {
  const NewsDetailPage({super.key, required this.id});

  final String id;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final detail = ref.watch(newsDetailProvider(id));
    return Scaffold(
      appBar: AppBar(title: const Text('Alerta de notícia')),
      body: switch (detail) {
        AsyncValue(:final value?) => RefreshIndicator(
            onRefresh: () => ref.refresh(newsDetailProvider(id).future),
            child: _Body(detail: value),
          ),
        AsyncValue(:final error?) => ErrorState(error: error, onRetry: () => ref.invalidate(newsDetailProvider(id))),
        _ => const LoadingSkeleton(items: 3),
      },
    );
  }
}

class _Body extends StatelessWidget {
  const _Body({required this.detail});

  final NewsAlertDetail detail;

  @override
  Widget build(BuildContext context) {
    final a = detail.alert;
    final tone = newsTone(a.severity);
    final inactive = a.status != NewsAlertStatus.active;
    return ListView(
      padding: const EdgeInsets.only(bottom: AcSpacing.xxl),
      children: [
        Container(
          color: inactive ? AcColors.textSecondary : tone.header,
          padding: const EdgeInsets.fromLTRB(AcSpacing.lg, AcSpacing.lg, AcSpacing.lg, AcSpacing.xl),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Row(children: [
              Icon(newsIcon(a), color: AcColors.onPrimary, size: 20),
              const SizedBox(width: AcSpacing.sm),
              Expanded(
                child: Text(
                  '${a.isOfficial ? 'Comunicado oficial' : 'Notícia'} · N-${a.code}',
                  style: AcTypeScale.label.copyWith(color: AcColors.onPrimary, fontWeight: FontWeight.w600),
                ),
              ),
            ]),
            const SizedBox(height: AcSpacing.sm),
            Semantics(header: true, child: Text(a.title, style: AcTypeScale.title.copyWith(color: AcColors.onPrimary))),
            if (a.headline != null) ...[
              const SizedBox(height: AcSpacing.xs),
              Text('Relatado: ${a.headline}', style: AcTypeScale.body.copyWith(color: AcColors.onPrimary)),
            ],
          ]),
        ),
        if (a.status == NewsAlertStatus.retracted)
          _Banner(
            icon: Icons.report_outlined,
            color: AcColors.error,
            title: 'Alerta retirado',
            text: detail.retractionReason ?? 'A informação foi corrigida.',
          )
        else if (a.status == NewsAlertStatus.resolved)
          const _Banner(icon: Icons.task_alt, color: AcColors.success, title: 'Situação encerrada', text: 'As fontes informam que a situação foi normalizada.')
        else if (a.status == NewsAlertStatus.expired)
          const _Banner(
            icon: Icons.history,
            color: AcColors.textSecondary,
            title: 'Sem atualizações recentes',
            text: 'Nenhuma fonte trouxe novidades nas últimas horas. Isso não confirma que a via esteja liberada.',
          ),
        Padding(
          padding: const EdgeInsets.fromLTRB(AcSpacing.lg, AcSpacing.lg, AcSpacing.lg, 0),
          child: Wrap(spacing: AcSpacing.sm, runSpacing: AcSpacing.xs, children: [NewsSeverityBadge(a.severity), NewsLevelBadge(a.level)]),
        ),
        Padding(
          padding: const EdgeInsets.fromLTRB(AcSpacing.lg, AcSpacing.md, AcSpacing.lg, 0),
          child: Text(newsOriginText(a), style: AcTypeScale.label.copyWith(color: AcColors.textSecondary)),
        ),
        Padding(
          padding: const EdgeInsets.all(AcSpacing.lg),
          child: SectionCard(
            title: 'Onde e quando',
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              _Row(Icons.place_outlined, a.placeLabel, 'Abrangência: ${precisionLabel(a.locationPrecision)}'),
              if (a.eventOccurredAt != null) _Row(Icons.event_outlined, 'Ocorrido em ${Formatters.dateTime(a.eventOccurredAt!)}', null),
              _Row(Icons.schedule, 'Publicado no app em ${Formatters.dateTime(a.publishedAt)}', 'Última notícia ${Formatters.relative(a.lastEvidenceAt)}'),
              if (a.severity == null)
                _Row(Icons.info_outline, 'Gravidade não informada', 'As fontes não descrevem o impacto. Isso não significa risco baixo.'),
            ]),
          ),
        ),
        Padding(
          padding: const EdgeInsets.symmetric(horizontal: AcSpacing.lg),
          child: Semantics(
            header: true,
            child: Text('Fontes (${detail.sources.length})', style: AcTypeScale.subtitle),
          ),
        ),
        const SizedBox(height: AcSpacing.sm),
        for (final s in detail.sources) _SourceCard(source: s),
        const Padding(
          padding: EdgeInsets.fromLTRB(AcSpacing.lg, AcSpacing.md, AcSpacing.lg, 0),
          child: Text(
            'Alertas de notícia são montados automaticamente a partir de reportagens e comunicados públicos e '
            'conferidos pela moderação quando necessário. Em risco, ligue 199 (Defesa Civil) ou 193 (Bombeiros).',
            style: AcTypeScale.caption,
          ),
        ),
      ],
    );
  }
}

class _Banner extends StatelessWidget {
  const _Banner({required this.icon, required this.color, required this.title, required this.text});

  final IconData icon;
  final Color color;
  final String title;
  final String text;

  @override
  Widget build(BuildContext context) => Container(
        margin: const EdgeInsets.fromLTRB(AcSpacing.lg, AcSpacing.lg, AcSpacing.lg, 0),
        padding: const EdgeInsets.all(AcSpacing.md),
        decoration: BoxDecoration(
          color: color.withValues(alpha: 0.08),
          borderRadius: BorderRadius.circular(AcRadius.md),
          border: Border.all(color: color.withValues(alpha: 0.4)),
        ),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Icon(icon, color: color),
          const SizedBox(width: AcSpacing.md),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(title, style: AcTypeScale.bodyStrong.copyWith(color: color)),
              const SizedBox(height: AcSpacing.xxs),
              Text(text, style: AcTypeScale.label),
            ]),
          ),
        ]),
      );
}

class _Row extends StatelessWidget {
  const _Row(this.icon, this.text, this.secondary);

  final IconData icon;
  final String text;
  final String? secondary;

  @override
  Widget build(BuildContext context) => Padding(
        padding: const EdgeInsets.only(bottom: AcSpacing.sm),
        child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Icon(icon, size: 20, color: AcColors.textSecondary),
          const SizedBox(width: AcSpacing.sm),
          Expanded(
            child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
              Text(text, style: AcTypeScale.body),
              if (secondary != null) Text(secondary!, style: AcTypeScale.caption.copyWith(color: AcColors.textSecondary)),
            ]),
          ),
        ]),
      );
}

class _SourceCard extends StatelessWidget {
  const _SourceCard({required this.source});

  final NewsArticleRef source;

  @override
  Widget build(BuildContext context) {
    final s = source;
    final meta = [
      s.sourceName,
      if (s.reliability == 'OFFICIAL') 'fonte oficial',
      if (s.publishedAt != null) Formatters.dateTime(s.publishedAt!),
    ].join(' · ');
    return Card(
      margin: const EdgeInsets.fromLTRB(AcSpacing.lg, 0, AcSpacing.lg, AcSpacing.md),
      child: Padding(
        padding: const EdgeInsets.all(AcSpacing.lg),
        child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
          Text(meta, style: AcTypeScale.caption.copyWith(color: AcColors.textSecondary)),
          const SizedBox(height: AcSpacing.xs),
          Text(s.title, style: AcTypeScale.bodyStrong),
          if (s.summary != null && s.summary!.isNotEmpty) ...[
            const SizedBox(height: AcSpacing.xs),
            Text(s.summary!, style: AcTypeScale.label.copyWith(color: AcColors.textSecondary), maxLines: 4, overflow: TextOverflow.ellipsis),
          ],
          if (!s.independent) ...[
            const SizedBox(height: AcSpacing.xs),
            Text(
              'Republicação ou mesma agência — não conta como confirmação independente.',
              style: AcTypeScale.caption.copyWith(color: AcColors.textSecondary, fontStyle: FontStyle.italic),
            ),
          ],
          Align(
            alignment: Alignment.centerRight,
            child: TextButton.icon(
              onPressed: s.url == null ? null : () => openOriginalNews(context, s.url),
              icon: const Icon(Icons.open_in_new, size: 18),
              label: const Text('Abrir notícia'),
            ),
          ),
        ]),
      ),
    );
  }
}
