import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/intl.dart';
import 'package:material_ui/material_ui.dart';

import '../../core/theme/app_tokens.g.dart';
import '../../core/widgets/common.dart';
import '../../core/widgets/states.dart';
import '../../domain/models.dart';
import '../../domain/news.dart';
import 'news_feed_state.dart';
import 'news_widgets.dart';

final _short = DateFormat('dd/MM HH:mm', 'pt_BR');

/// Há quanto tempo uma notícia conta como "recente" na lista.
const recentWindow = Duration(hours: 2);

String _periodLabel(int hours) => switch (hours) {
      24 => 'Últimas 24 h',
      72 => 'Últimos 3 dias',
      168 => 'Últimos 7 dias',
      _ => 'Últimas $hours h',
    };

/// "Notícias e monitoramento" (Etapa 9, wireframe 7.9): alertas identificados em fontes jornalísticas e
/// institucionais, em vigor e recentes. Acessada pela central de Alertas (sem 5ª aba).
class NewsMonitorPage extends ConsumerWidget {
  const NewsMonitorPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final feed = ref.watch(newsFeedProvider);
    final filters = ref.watch(newsFeedFiltersProvider);

    return Scaffold(
      appBar: AppBar(title: const Text('Notícias sobre alagamentos')),
      body: RefreshIndicator(
        onRefresh: () => ref.refresh(newsFeedProvider.future),
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.fromLTRB(AcSpacing.lg, AcSpacing.sm, AcSpacing.lg, AcSpacing.xxl),
          children: [
            Text(
              'Informações recentes identificadas em fontes jornalísticas e institucionais.',
              style: AcTypeScale.label.copyWith(color: AcColors.textSecondary),
            ),
            const SizedBox(height: AcSpacing.md),
            _FilterBar(filters: filters),
            const SizedBox(height: AcSpacing.md),
            ...feed.when(
              skipLoadingOnRefresh: true,
              skipLoadingOnReload: false,
              data: (page) => [
                if (page.fromCache) _SavedBanner(savedAt: page.savedAt!),
                if (page.items.isEmpty)
                  EmptyState(
                    icon: Icons.newspaper_outlined,
                    title: filters.isDefault ? 'Nenhuma notícia de alagamento nas regiões monitoradas' : 'Nenhuma notícia com estes filtros',
                    message: filters.isDefault
                        ? 'Quando fontes jornalísticas ou oficiais relatarem alagamentos, eles aparecem aqui.'
                        : 'Tente outro período ou outra cidade.',
                    action: filters.isDefault
                        ? null
                        : OutlinedButton.icon(
                            onPressed: () => ref.read(newsFeedFiltersProvider.notifier).reset(),
                            icon: const Icon(Icons.filter_alt_off_outlined),
                            label: const Text('Limpar filtros'),
                          ),
                  )
                else ...[
                  for (final a in page.items)
                    Padding(
                      padding: const EdgeInsets.only(bottom: AcSpacing.md),
                      child: NewsFeedCard(alert: a, onOpen: () => context.push('/news/${a.id}')),
                    ),
                  if (page.hasMore)
                    OutlinedButton(
                      onPressed: () async {
                        try {
                          await ref.read(newsFeedProvider.notifier).loadMore();
                        } catch (_) {
                          if (context.mounted) showAppSnackbar(context, 'Não foi possível carregar mais. Verifique a conexão.', kind: SnackKind.error);
                        }
                      },
                      child: const Text('Carregar mais'),
                    ),
                ],
                const SizedBox(height: AcSpacing.lg),
                Text(
                  'Alertas de notícia são montados automaticamente a partir de reportagens e comunicados públicos. '
                  'Só o rótulo "Comunicado oficial" indica fonte oficial. Em risco, ligue 199 (Defesa Civil) ou 193 (Bombeiros).',
                  style: AcTypeScale.caption.copyWith(color: AcColors.textSecondary),
                ),
              ],
              loading: () => const [LoadingSkeleton(items: 3, itemHeight: 150)],
              error: (e, _) => [ErrorState(error: e, onRetry: () => ref.invalidate(newsFeedProvider))],
            ),
          ],
        ),
      ),
    );
  }
}

class _SavedBanner extends StatelessWidget {
  const _SavedBanner({required this.savedAt});

  final DateTime savedAt;

  @override
  Widget build(BuildContext context) => Semantics(
        liveRegion: true,
        child: Container(
          margin: const EdgeInsets.only(bottom: AcSpacing.md),
          padding: const EdgeInsets.all(AcSpacing.md),
          decoration: BoxDecoration(color: AcColors.surfaceMuted, borderRadius: BorderRadius.circular(AcRadius.md), border: Border.all(color: AcColors.border)),
          child: Row(children: [
            const Icon(Icons.wifi_off_rounded, size: 20, color: AcColors.textSecondary),
            const SizedBox(width: AcSpacing.sm),
            Expanded(
              child: Text(
                'Sem conexão. Mostrando as notícias salvas em ${_short.format(savedAt)} — podem estar desatualizadas.',
                style: AcTypeScale.label,
              ),
            ),
          ]),
        ),
      );
}

/// Cartão da lista (wireframe 7.9): faixa na cor da gravidade, situação, verificação, título,
/// "fonte · data · cidade", resumo do feed, nº de fontes e link para a notícia original.
class NewsFeedCard extends StatelessWidget {
  const NewsFeedCard({super.key, required this.alert, required this.onOpen, this.now});

  final NewsAlert alert;
  final VoidCallback onOpen;

  /// Para testes.
  final DateTime? now;

  @override
  Widget build(BuildContext context) {
    final a = alert;
    final tone = newsTone(a.severity);
    final source = a.primarySource;
    final recent = a.status == NewsAlertStatus.active && (now ?? DateTime.now()).difference(a.lastEvidenceAt) <= recentWindow;
    final meta = [
      source?.name ?? 'Fonte não informada',
      _short.format(source?.publishedAt ?? a.publishedAt),
      a.city ?? a.regionName,
    ].whereType<String>().join(' · ');

    return Card(
      margin: EdgeInsets.zero,
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onOpen,
        child: IntrinsicHeight(
          child: Row(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
            Container(width: 6, color: a.status == NewsAlertStatus.active ? tone.marker : AcColors.borderStrong),
            Expanded(
              child: Padding(
                padding: const EdgeInsets.fromLTRB(AcSpacing.md, AcSpacing.md, AcSpacing.md, AcSpacing.xs),
                child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                  Wrap(spacing: AcSpacing.sm, runSpacing: AcSpacing.xs, crossAxisAlignment: WrapCrossAlignment.center, children: [
                    NewsSeverityBadge(a.severity),
                    if (recent)
                      Semantics(
                        label: 'Recente',
                        excludeSemantics: true,
                        child: Row(mainAxisSize: MainAxisSize.min, children: [
                          const Icon(Icons.circle, size: 8, color: AcColors.error),
                          const SizedBox(width: AcSpacing.xs),
                          Text('Recente', style: AcTypeScale.caption.copyWith(fontWeight: FontWeight.w600)),
                        ]),
                      )
                    else if (a.status != NewsAlertStatus.active)
                      Text(a.status.label, style: AcTypeScale.caption.copyWith(color: AcColors.textSecondary, fontWeight: FontWeight.w600)),
                    NewsLevelBadge(a.level),
                  ]),
                  const SizedBox(height: AcSpacing.sm),
                  Text(a.title, style: AcTypeScale.subtitle, maxLines: 3, overflow: TextOverflow.ellipsis),
                  const SizedBox(height: AcSpacing.xxs),
                  Text(meta, style: AcTypeScale.caption.copyWith(color: AcColors.textSecondary)),
                  if (source?.summary != null && source!.summary!.isNotEmpty) ...[
                    const SizedBox(height: AcSpacing.xs),
                    Text(source.summary!, style: AcTypeScale.label.copyWith(color: AcColors.textSecondary), maxLines: 3, overflow: TextOverflow.ellipsis),
                  ],
                  Row(children: [
                    Icon(Icons.layers_outlined, size: 16, color: AcColors.textSecondary),
                    const SizedBox(width: AcSpacing.xs),
                    Text(a.sourceCount == 1 ? '1 fonte' : '${a.sourceCount} fontes', style: AcTypeScale.caption.copyWith(color: AcColors.textSecondary)),
                    const Spacer(),
                    TextButton.icon(
                      onPressed: source?.url == null ? null : () => openOriginalNews(context, source!.url),
                      icon: const Icon(Icons.open_in_new, size: 16),
                      label: const Text('Ver original'),
                    ),
                  ]),
                ]),
              ),
            ),
          ]),
        ),
      ),
    );
  }
}

/// Filtros em "pílulas" com seta (Cidade ▾, Período ▾, Gravidade ▾, Fonte ▾, Verificação ▾); cada uma
/// abre uma folha com as opções. As ativas ficam destacadas, e aparece "Limpar".
class _FilterBar extends ConsumerWidget {
  const _FilterBar({required this.filters});

  final NewsFeedFilters filters;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final f = filters;
    final notifier = ref.read(newsFeedFiltersProvider.notifier);
    final options = ref.watch(newsFilterOptionsProvider).value;

    Future<void> pickCity() async {
      final cities = options?.cities ?? const [];
      final picked = await _pickOne<String?>(context, 'Cidade', [
        (value: null, label: 'Todas as cidades monitoradas'),
        for (final c in cities) (value: c.ibge, label: c.name),
      ], f.cityIbge);
      if (picked == null) return;
      final city = cities.where((c) => c.ibge == picked.value).firstOrNull;
      notifier.set(f.copyWith(city: () => city == null ? null : (ibge: city.ibge, name: city.name)));
    }

    Future<void> pickSource() async {
      final sources = options?.sources ?? const [];
      final picked = await _pickOne<String?>(context, 'Fonte', [
        (value: null, label: 'Todas as fontes'),
        for (final s in sources) (value: s.key, label: s.official ? '${s.name} (oficial)' : s.name),
      ], f.sourceKey);
      if (picked == null) return;
      final source = sources.where((s) => s.key == picked.value).firstOrNull;
      notifier.set(f.copyWith(source: () => source == null ? null : (key: source.key, name: source.name)));
    }

    Future<void> pickPeriod() async {
      final picked = await _pickOne<int>(context, 'Período', [for (final h in NewsFeedFilters.periods) (value: h, label: _periodLabel(h))], f.periodHours);
      if (picked != null) notifier.set(f.copyWith(periodHours: picked.value));
    }

    Future<void> pickSeverity() async {
      final picked = await _pickMany<Severity>(context, 'Gravidade', [for (final s in Severity.values.reversed) (value: s, label: s.label)], f.severities);
      if (picked != null) notifier.set(f.copyWith(severities: picked));
    }

    Future<void> pickLevel() async {
      final picked = await _pickMany<NewsAlertLevel>(context, 'Verificação', [for (final l in NewsAlertLevel.values) (value: l, label: l.label)], f.levels);
      if (picked != null) notifier.set(f.copyWith(levels: picked));
    }

    return SingleChildScrollView(
      scrollDirection: Axis.horizontal,
      clipBehavior: Clip.none,
      child: Row(children: [
        if (!f.isDefault)
          _Chip(label: 'Limpar', icon: Icons.filter_alt_off_outlined, active: false, onTap: notifier.reset),
        _Chip(label: f.cityName ?? 'Cidade', active: f.cityIbge != null, onTap: pickCity),
        _Chip(label: _periodLabel(f.periodHours), active: f.periodHours != NewsFeedFilters.defaultPeriodHours, onTap: pickPeriod),
        _Chip(label: f.severities.isEmpty ? 'Gravidade' : f.severities.map((s) => s.label).join(', '), active: f.severities.isNotEmpty, onTap: pickSeverity),
        _Chip(label: f.sourceName ?? 'Fonte', active: f.sourceKey != null, onTap: pickSource),
        _Chip(label: f.levels.isEmpty ? 'Verificação' : f.levels.map((l) => l.label).join(', '), active: f.levels.isNotEmpty, onTap: pickLevel),
      ]),
    );
  }
}

class _Chip extends StatelessWidget {
  const _Chip({required this.label, required this.active, required this.onTap, this.icon});

  final String label;
  final bool active;
  final VoidCallback onTap;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    final fg = active ? AcColors.primaryDark : AcColors.textPrimary;
    return Padding(
      padding: const EdgeInsets.only(right: AcSpacing.sm),
      child: ActionChip(
        onPressed: onTap,
        tooltip: active ? 'Filtro ativo: $label' : null,
        backgroundColor: active ? AcColors.primaryLight : AcColors.surface,
        shape: StadiumBorder(side: BorderSide(color: active ? AcColors.primary : AcColors.border)),
        avatar: icon == null ? null : Icon(icon, size: 16, color: fg),
        label: Row(mainAxisSize: MainAxisSize.min, children: [
          Text(label, style: AcTypeScale.label.copyWith(color: fg, fontWeight: active ? FontWeight.w600 : FontWeight.w500)),
          if (icon == null) Icon(Icons.arrow_drop_down, size: 18, color: fg),
        ]),
      ),
    );
  }
}

/// Escolha única. Devolve `null` se a folha foi fechada sem escolher (o valor escolhido pode ser null = "todas").
Future<({T value})?> _pickOne<T>(BuildContext context, String title, List<({T value, String label})> options, T current) {
  return showModalBottomSheet<({T value})>(
    context: context,
    showDragHandle: true,
    isScrollControlled: true,
    useSafeArea: true,
    builder: (context) => ConstrainedBox(
      constraints: BoxConstraints(maxHeight: MediaQuery.sizeOf(context).height * 0.7),
      child: ListView(shrinkWrap: true, children: [
        Padding(
          padding: const EdgeInsets.fromLTRB(AcSpacing.xl, 0, AcSpacing.xl, AcSpacing.sm),
          child: Semantics(header: true, child: Text(title, style: AcTypeScale.title)),
        ),
        for (final o in options)
          ListTile(
            title: Text(o.label),
            trailing: o.value == current ? const Icon(Icons.check, color: AcColors.primary) : null,
            selected: o.value == current,
            onTap: () => Navigator.of(context).pop((value: o.value)),
          ),
      ]),
    ),
  );
}

/// Escolha múltipla com "Aplicar"; nenhuma marcada = todas.
Future<Set<T>?> _pickMany<T>(BuildContext context, String title, List<({T value, String label})> options, Set<T> current) {
  return showModalBottomSheet<Set<T>>(
    context: context,
    showDragHandle: true,
    useSafeArea: true,
    builder: (context) {
      final selected = {...current};
      return StatefulBuilder(
        builder: (context, setState) => Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.stretch, children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(AcSpacing.xl, 0, AcSpacing.xl, AcSpacing.sm),
            child: Semantics(header: true, child: Text(title, style: AcTypeScale.title)),
          ),
          for (final o in options)
            CheckboxListTile(
              title: Text(o.label),
              value: selected.contains(o.value),
              onChanged: (v) => setState(() => v == true ? selected.add(o.value) : selected.remove(o.value)),
            ),
          Padding(
            padding: const EdgeInsets.all(AcSpacing.lg),
            child: FilledButton(onPressed: () => Navigator.of(context).pop(selected), child: const Text('Aplicar')),
          ),
        ]),
      );
    },
  );
}
