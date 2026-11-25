import 'dart:async';

import 'package:flutter/services.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:latlong2/latlong.dart';
import 'package:material_ui/material_ui.dart';

import '../../core/config/app_config.dart';
import '../../core/theme/app_tokens.g.dart';
import '../../core/utils/formatters.dart';
import '../../core/widgets/common.dart';
import '../../core/widgets/occurrence_card.dart';
import '../../core/widgets/severity_widgets.dart';
import '../../core/widgets/states.dart';
import '../../domain/models.dart';
import '../../domain/news.dart';
import '../news/news_state.dart';
import '../news/news_widgets.dart';
import 'filters_sheet.dart';
import 'map_summary_card.dart';
import 'map_state.dart';

class MapPage extends ConsumerStatefulWidget {
  const MapPage({super.key});

  @override
  ConsumerState<MapPage> createState() => _MapPageState();
}

class _MapPageState extends ConsumerState<MapPage> {
  final _map = MapController();
  final _sheet = DraggableScrollableController();
  final _search = TextEditingController();
  Timer? _debounce;
  bool _movedAway = false;

  @override
  void initState() {
    super.initState();
    // Usa a localização apenas se o usuário já concedeu a permissão antes (sem pedir de novo).
    WidgetsBinding.instance.addPostFrameCallback((_) async {
      final result = await ref.read(userLocationProvider.notifier).locate(request: false);
      if (result.ok && mounted) _map.move(result.position!, 14);
    });
  }

  @override
  void dispose() {
    _debounce?.cancel();
    _search.dispose();
    _sheet.dispose();
    _map.dispose();
    super.dispose();
  }

  void _onSearchChanged(String value) {
    _debounce?.cancel();
    _debounce = Timer(const Duration(milliseconds: 400), () => ref.read(mapFiltersProvider.notifier).setQuery(value));
  }

  Future<void> _centerOnUser() async {
    final result = await ref.read(userLocationProvider.notifier).locate();
    if (!mounted) return;
    if (result.ok) {
      _map.move(result.position!, 15);
      setState(() => _movedAway = false);
    } else {
      showAppSnackbar(context, result.message, kind: SnackKind.error);
    }
  }

  void _searchHere() {
    ref.read(searchAreaProvider.notifier).set(SearchArea(_map.camera.center));
    setState(() => _movedAway = false);
  }

  void _selectMarker(OccurrenceSummary o) {
    ref.read(selectedNewsProvider.notifier).select(null);
    ref.read(selectedOccurrenceProvider.notifier).select(o.id);
    _focus(LatLng(o.latitude, o.longitude));
  }

  void _selectNews(NewsAlert a) {
    ref.read(selectedOccurrenceProvider.notifier).select(null);
    ref.read(selectedNewsProvider.notifier).select(a.id);
    _focus(a.anchor!); // alerta regional: o rótulo no centro da área
  }

  void _clearSelection() {
    ref.read(selectedOccurrenceProvider.notifier).select(null);
    ref.read(selectedNewsProvider.notifier).select(null);
  }

  /// O marcador fica acima do resumo flutuante (nunca escondido atrás dele) e o painel recolhe.
  void _focus(LatLng point) {
    final height = MediaQuery.sizeOf(context).height;
    _map.move(point, _map.camera.zoom, offset: Offset(0, -height * 0.16));
    if (_sheet.isAttached) _sheet.animateTo(_NearbySheet.minSize, duration: AcMotion.slow, curve: Curves.easeOutCubic);
  }

  Marker _newsMarker(NewsAlert a, bool selected) => Marker(
        key: ValueKey('news-marker-${a.id}'),
        point: a.anchor!,
        width: NewsMarker.size + 8,
        height: NewsMarker.size + 8,
        child: GestureDetector(
          onTap: () => _selectNews(a),
          child: Center(child: NewsMarker(alert: a, selected: selected, compact: a.isRegional)),
        ),
      );

  @override
  Widget build(BuildContext context) {
    final data = ref.watch(nearbyOccurrencesProvider);
    final filters = ref.watch(mapFiltersProvider);
    final area = ref.watch(searchAreaProvider);
    final selectedId = ref.watch(selectedOccurrenceProvider);
    final userLocation = ref.watch(userLocationProvider);
    final items = data.value?.items ?? const <OccurrenceSummary>[];
    final selected = selectedId == null ? null : items.where((o) => o.id == selectedId).firstOrNull;
    final news = (ref.watch(nearbyNewsProvider).value ?? const <NewsAlert>[]).where((a) => a.anchor != null).toList();
    final selectedNewsId = ref.watch(selectedNewsProvider);
    final selectedNews = selectedNewsId == null ? null : news.where((a) => a.id == selectedNewsId).firstOrNull;

    // Mapa em tela cheia (inclusive atrás da barra de status): ícones escuros sobre o mapa claro.
    return AnnotatedRegion<SystemUiOverlayStyle>(
      value: SystemUiOverlayStyle.dark,
      child: Scaffold(
        body: LayoutBuilder(
          builder: (context, constraints) => Stack(
            children: [
              FlutterMap(
                mapController: _map,
                options: MapOptions(
                  initialCenter: area.center,
                  initialZoom: 13,
                  minZoom: 4,
                  maxZoom: 18,
                  // Tocar numa área vazia fecha o resumo.
                  onTap: (_, _) => _clearSelection(),
                  onPositionChanged: (camera, hasGesture) {
                    if (!hasGesture) return;
                    final far = const Distance().as(LengthUnit.Meter, camera.center, area.center) > filters.radiusMeters * 0.4;
                    if (far != _movedAway) setState(() => _movedAway = far);
                  },
                ),
                children: [
                  TileLayer(urlTemplate: AppConfig.tileUrlTemplate, userAgentPackageName: AppConfig.userAgentPackageName),
                  CircleLayer(
                    circles: [
                      CircleMarker(
                        point: area.center,
                        radius: filters.radiusMeters.toDouble(),
                        useRadiusInMeter: true,
                        color: AcColors.primary.withValues(alpha: 0.06),
                        borderColor: AcColors.primary.withValues(alpha: 0.35),
                        borderStrokeWidth: 1.5,
                      ),
                    ],
                  ),
                  // Alertas de notícia regionais: área translúcida (contorno oficial da cidade), sem pino.
                  _NewsAreasLayer(alerts: news.where((a) => a.isRegional).toList(), selectedId: selectedNewsId),
                  MarkerLayer(
                    markers: [
                      // Notícias por baixo dos relatos; a selecionada fica por cima de todos (abaixo).
                      for (final a in news.where((a) => a.id != selectedNewsId)) _newsMarker(a, false),
                      if (userLocation?.ok ?? false)
                        Marker(
                          point: userLocation!.position!,
                          width: 22,
                          height: 22,
                          child: Semantics(
                            label: 'Sua localização',
                            child: Container(
                              decoration: BoxDecoration(
                                color: AcColors.primary,
                                shape: BoxShape.circle,
                                border: Border.all(color: AcColors.surface, width: 3),
                                boxShadow: AcElevation.raised,
                              ),
                            ),
                          ),
                        ),
                      // O selecionado é desenhado por último, por cima dos vizinhos.
                      for (final o in [...items.where((o) => o.id != selectedId), ?selected])
                        Marker(
                          point: LatLng(o.latitude, o.longitude),
                          width: SeverityMarker.size + 8,
                          height: SeverityMarker.size + 8,
                          child: GestureDetector(
                            onTap: () => _selectMarker(o),
                            child: Center(child: SeverityMarker(severity: o.severity, status: o.status, selected: o.id == selectedId)),
                          ),
                        ),
                      if (selectedNews != null) _newsMarker(selectedNews, true),
                    ],
                  ),
                  const RichAttributionWidget(attributions: [TextSourceAttribution('OpenStreetMap contributors')]),
                ],
              ),
              if (data.isLoading) const Positioned(top: 0, left: 0, right: 0, child: LinearProgressIndicator(minHeight: 3)),
              SafeArea(
                bottom: false,
                child: Padding(
                  padding: const EdgeInsets.fromLTRB(AcSpacing.lg, AcSpacing.sm, AcSpacing.lg, 0),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.end,
                    children: [
                      _SearchBar(controller: _search, onChanged: _onSearchChanged),
                      const SizedBox(height: AcSpacing.sm),
                      const _QuickFilters(),
                      const SizedBox(height: AcSpacing.sm),
                      Row(
                        children: [
                          Expanded(
                            child: _movedAway
                                ? Align(
                                    alignment: Alignment.centerLeft,
                                    child: FilledButton.icon(
                                      style: FilledButton.styleFrom(minimumSize: const Size(0, 44), shape: const StadiumBorder()),
                                      onPressed: _searchHere,
                                      icon: const Icon(Icons.search, size: 18),
                                      label: const Text('Buscar nesta área'),
                                    ),
                                  )
                                : const SizedBox.shrink(),
                          ),
                          _RoundMapButton(icon: Icons.my_location, tooltip: 'Centralizar na minha localização', onPressed: _centerOnUser),
                        ],
                      ),
                    ],
                  ),
                ),
              ),
              _NearbySheet(
                controller: _sheet,
                data: data,
                selectedId: selectedId,
                fromUserLocation: area.fromUserLocation,
                onRetry: () {
                  ref.invalidate(nearbyOccurrencesProvider);
                  ref.invalidate(nearbyNewsProvider);
                },
                onOpen: (o) => context.push('/occurrences/${o.id}'),
                onUseLocation: _centerOnUser,
                onClearFilters: () => ref.read(mapFiltersProvider.notifier).reset(),
                hasFilters: !filters.isDefault,
              ),
              // Resumo do marcador OU botão de registrar, sempre logo acima do painel inferior
              // (nunca no meio do mapa); somem quando o painel está quase em tela cheia.
              ListenableBuilder(
                listenable: _sheet,
                builder: (context, _) {
                  final size = _sheet.isAttached ? _sheet.size : _NearbySheet.initialSize;
                  if (size > 0.65) return const SizedBox.shrink();
                  final sheetTop = constraints.maxHeight * size;
                  // O resumo fica acima do painel; o botão de registrar fica com metade sobre a borda
                  // do painel (como em apps de mapa), cobrindo o mínimo possível do mapa.
                  final hasSummary = selected != null || selectedNews != null;
                  final bottom = hasSummary ? sheetTop + AcSpacing.md : sheetTop - 28;
                  return Positioned(
                    // Largura sempre limitada: durante a troca animada o cartão que sai ainda é
                    // desenhado, e sem `left` ele receberia largura infinita (erro de layout).
                    left: AcSpacing.lg,
                    right: AcSpacing.lg,
                    bottom: bottom,
                    child: AnimatedSwitcher(
                      duration: AcMotion.base,
                      transitionBuilder: (child, anim) => FadeTransition(
                        opacity: anim,
                        child: SlideTransition(position: Tween(begin: const Offset(0, 0.15), end: Offset.zero).animate(anim), child: child),
                      ),
                      child: selectedNews != null
                          ? NewsSummaryCard(
                              key: ValueKey('news-${selectedNews.id}'),
                              alert: selectedNews,
                              onOpen: () => context.push('/news/${selectedNews.id}'),
                              onClose: _clearSelection,
                            )
                          : selected != null
                          ? MapSummaryCard(
                              key: ValueKey(selected.id),
                              occurrence: selected,
                              onOpen: () => context.push('/occurrences/${selected.id}'),
                              onClose: () => ref.read(selectedOccurrenceProvider.notifier).select(null),
                            )
                          : Align(
                              key: const ValueKey('registrar'),
                              alignment: Alignment.centerRight,
                              child: FloatingActionButton.extended(
                                onPressed: () => context.push('/occurrences/new'),
                                icon: const Icon(Icons.add),
                                label: const Text('Registrar ocorrência'),
                              ),
                            ),
                    ),
                  );
                },
              ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Busca flutuante em pílula: logo, campo e filtros (com a quantidade de filtros ativos).
class _SearchBar extends ConsumerWidget {
  const _SearchBar({required this.controller, required this.onChanged});

  final TextEditingController controller;
  final ValueChanged<String> onChanged;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final f = ref.watch(mapFiltersProvider);
    final active = [f.severities.isNotEmpty, f.statuses.isNotEmpty, f.radiusMeters != 5000, f.periodHours != null].where((x) => x).length;
    return DecoratedBox(
      decoration: BoxDecoration(borderRadius: BorderRadius.circular(AcRadius.pill), boxShadow: AcElevation.raised),
      child: Material(
        color: AcColors.surface,
        shape: const StadiumBorder(),
        clipBehavior: Clip.antiAlias,
        child: Row(
          children: [
            const Padding(padding: EdgeInsets.only(left: AcSpacing.sm), child: AppLogo(size: 36, showName: false)),
            Expanded(
              child: TextField(
                controller: controller,
                onChanged: onChanged,
                textInputAction: TextInputAction.search,
                decoration: InputDecoration(
                  hintText: 'Buscar endereço ou bairro',
                  filled: false,
                  border: InputBorder.none,
                  enabledBorder: InputBorder.none,
                  focusedBorder: InputBorder.none,
                  contentPadding: const EdgeInsets.symmetric(horizontal: AcSpacing.md, vertical: AcSpacing.lg),
                  suffixIcon: controller.text.isEmpty
                      ? null
                      : IconButton(
                          tooltip: 'Limpar busca',
                          icon: const Icon(Icons.close),
                          onPressed: () {
                            controller.clear();
                            onChanged('');
                          },
                        ),
                ),
              ),
            ),
            Badge(
              isLabelVisible: active > 0,
              label: Text('$active'),
              offset: const Offset(-6, 6),
              child: IconButton(
                tooltip: active > 0 ? 'Filtros ($active ativos)' : 'Filtros',
                icon: const Icon(Icons.tune, color: AcColors.primary),
                onPressed: () async {
                  final result = await showFiltersSheet(context, f);
                  if (result != null) ref.read(mapFiltersProvider.notifier).set(result);
                },
              ),
            ),
            const SizedBox(width: AcSpacing.xs),
          ],
        ),
      ),
    );
  }
}

/// Filtros rápidos sobre o mapa; ativos ficam destacados e aparece "Limpar".
class _QuickFilters extends ConsumerWidget {
  const _QuickFilters();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final f = ref.watch(mapFiltersProvider);
    Future<void> open(FilterSection section) async {
      final result = await showFiltersSheet(context, f, focus: section);
      if (result != null) ref.read(mapFiltersProvider.notifier).set(result);
    }

    return SizedBox(
      height: 40,
      child: ListView(
        scrollDirection: Axis.horizontal,
        clipBehavior: Clip.none,
        children: [
          if (!f.isDefault)
            _QuickChip(label: 'Limpar', icon: Icons.filter_alt_off_outlined, active: false, onTap: () => ref.read(mapFiltersProvider.notifier).reset()),
          _QuickChip(
            label: 'Notícias',
            icon: Icons.newspaper,
            active: ref.watch(newsLayerProvider),
            toggle: true,
            onTap: () {
              ref.read(selectedNewsProvider.notifier).select(null);
              ref.read(newsLayerProvider.notifier).toggle();
            },
          ),
          _QuickChip(
            label: f.severities.isEmpty ? 'Gravidade' : f.severities.map((s) => s.label).join(', '),
            active: f.severities.isNotEmpty,
            onTap: () => open(FilterSection.severity),
          ),
          _QuickChip(
            label: f.statuses.isEmpty ? 'Status' : f.statuses.map((s) => s.label).join(', '),
            active: f.statuses.isNotEmpty,
            onTap: () => open(FilterSection.status),
          ),
          _QuickChip(label: 'Até ${Formatters.distance(f.radiusMeters)}', active: f.radiusMeters != 5000, onTap: () => open(FilterSection.distance)),
          _QuickChip(
            label: f.periodHours == null ? 'Período' : periodLabel(f.periodHours!),
            active: f.periodHours != null,
            onTap: () => open(FilterSection.period),
          ),
        ],
      ),
    );
  }
}

class _QuickChip extends StatelessWidget {
  const _QuickChip({required this.label, required this.active, required this.onTap, this.icon, this.toggle = false});

  final String label;
  final bool active;
  final VoidCallback onTap;
  final IconData? icon;

  /// Liga/desliga (ex.: camada de notícias) em vez de abrir os filtros.
  final bool toggle;

  @override
  Widget build(BuildContext context) {
    final fg = active ? AcColors.primaryDark : AcColors.textPrimary;
    return Padding(
      padding: const EdgeInsets.only(right: AcSpacing.sm),
      child: DecoratedBox(
        decoration: BoxDecoration(borderRadius: BorderRadius.circular(AcRadius.pill), boxShadow: AcElevation.card),
        child: ActionChip(
          onPressed: onTap,
          tooltip: toggle ? (active ? '$label: visível (toque para ocultar)' : '$label: oculto (toque para mostrar)') : active ? 'Filtro ativo: $label' : null,
          backgroundColor: active ? AcColors.primaryLight : AcColors.surface,
          shape: StadiumBorder(side: BorderSide(color: active ? AcColors.primary : AcColors.surface)),
          avatar: icon == null ? (active ? const Icon(Icons.check, size: 16, color: AcColors.primaryDark) : null) : Icon(icon, size: 16, color: fg),
          label: Row(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(label, style: AcTypeScale.label.copyWith(color: fg, fontWeight: active ? FontWeight.w600 : FontWeight.w500)),
              if (icon == null) Icon(Icons.arrow_drop_down, size: 18, color: fg),
            ],
          ),
        ),
      ),
    );
  }
}

/// Botão redondo branco sobre o mapa (48 × 48).
class _RoundMapButton extends StatelessWidget {
  const _RoundMapButton({required this.icon, required this.tooltip, required this.onPressed});

  final IconData icon;
  final String tooltip;
  final VoidCallback onPressed;

  @override
  Widget build(BuildContext context) {
    return DecoratedBox(
      decoration: const BoxDecoration(shape: BoxShape.circle, boxShadow: AcElevation.raised),
      child: IconButton(
        tooltip: tooltip,
        style: IconButton.styleFrom(backgroundColor: AcColors.surface, minimumSize: const Size(48, 48)),
        icon: Icon(icon, color: AcColors.primary),
        onPressed: onPressed,
      ),
    );
  }
}

class _NearbySheet extends StatelessWidget {
  const _NearbySheet({
    required this.controller,
    required this.data,
    required this.selectedId,
    required this.fromUserLocation,
    required this.onRetry,
    required this.onOpen,
    required this.onUseLocation,
    required this.onClearFilters,
    required this.hasFilters,
  });

  final DraggableScrollableController controller;
  final AsyncValue<Paged<OccurrenceSummary>> data;
  final String? selectedId;
  final bool fromUserLocation;
  final VoidCallback onRetry;
  final ValueChanged<OccurrenceSummary> onOpen;
  final VoidCallback onUseLocation;
  final VoidCallback onClearFilters;
  final bool hasFilters;

  static const initialSize = 0.26;
  static const minSize = 0.14;

  @override
  Widget build(BuildContext context) {
    return DraggableScrollableSheet(
      controller: controller,
      initialChildSize: initialSize,
      minChildSize: minSize,
      maxChildSize: 0.9,
      snap: true,
      snapSizes: const [initialSize, 0.6],
      builder: (context, scroll) {
        final page = data.value;
        var items = page?.items ?? const <OccurrenceSummary>[];
        // O item selecionado no mapa sobe para o topo da lista.
        if (selectedId != null) {
          items = [...items.where((o) => o.id == selectedId), ...items.where((o) => o.id != selectedId)];
        }
        return Material(
          color: AcColors.background,
          elevation: 8,
          shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(AcRadius.xl))),
          clipBehavior: Clip.antiAlias,
          child: CustomScrollView(
            controller: scroll,
            slivers: [
              SliverToBoxAdapter(
                child: Column(
                  children: [
                    const SizedBox(height: AcSpacing.sm),
                    Container(
                      width: 40,
                      height: 4,
                      decoration: BoxDecoration(color: AcColors.borderStrong, borderRadius: BorderRadius.circular(2)),
                    ),
                    Padding(
                      padding: const EdgeInsets.fromLTRB(AcSpacing.lg, AcSpacing.md, AcSpacing.lg, AcSpacing.sm),
                      child: Row(
                        children: [
                          Expanded(
                            child: Semantics(
                              header: true,
                              child: Text(
                                fromUserLocation ? 'Ocorrências próximas' : 'Ocorrências na área',
                                style: AcTypeScale.title,
                              ),
                            ),
                          ),
                          TextButton.icon(
                            onPressed: () => showSeverityLevels(context),
                            icon: const Icon(Icons.info_outline, size: 18),
                            label: const Text('Legenda'),
                          ),
                          if (page != null)
                            Container(
                              padding: const EdgeInsets.symmetric(horizontal: AcSpacing.sm, vertical: AcSpacing.xxs),
                              decoration: BoxDecoration(
                                color: AcColors.primaryLight,
                                borderRadius: BorderRadius.circular(AcRadius.pill),
                              ),
                              child: Text(
                                '${page.total}',
                                style: AcTypeScale.label.copyWith(
                                  color: AcColors.primaryDark,
                                  fontWeight: FontWeight.w700,
                                ),
                              ),
                            ),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
              if (data.hasError && page == null)
                SliverFillRemaining(
                  hasScrollBody: false,
                  child: ErrorState(error: data.error!, onRetry: onRetry),
                )
              else if (page == null)
                const SliverToBoxAdapter(child: LoadingSkeleton(items: 3))
              else if (items.isEmpty)
                SliverFillRemaining(
                  hasScrollBody: false,
                  child: EmptyState(
                    icon: Icons.check_circle_outline,
                    title: 'Nenhuma ocorrência nesta área',
                    message: hasFilters
                        ? 'Nenhum registro com os filtros atuais.'
                        : fromUserLocation
                            ? 'Não há registros ativos perto de você. Isso é uma boa notícia!'
                            : 'Ative sua localização para ver o que acontece perto de você.',
                    action: hasFilters
                        ? OutlinedButton.icon(onPressed: onClearFilters, icon: const Icon(Icons.filter_alt_off_outlined), label: const Text('Limpar filtros'))
                        : fromUserLocation
                            ? null
                            : OutlinedButton.icon(
                                onPressed: onUseLocation,
                                icon: const Icon(Icons.my_location),
                                label: const Text('Usar minha localização'),
                              ),
                  ),
                )
              else
                SliverPadding(
                  padding: const EdgeInsets.fromLTRB(AcSpacing.lg, 0, AcSpacing.lg, 120),
                  sliver: SliverList.separated(
                    itemCount: items.length,
                    separatorBuilder: (_, _) => const SizedBox(height: AcSpacing.md),
                    itemBuilder: (_, i) => OccurrenceCard(
                      occurrence: items[i],
                      selected: items[i].id == selectedId,
                      onTap: () => onOpen(items[i]),
                    ),
                  ),
                ),
            ],
          ),
        );
      },
    );
  }
}

/// Usado pelo mapa e pelo filtro.
String periodLabel(int hours) => switch (hours) {
  <= 6 => 'Últimas $hours h',
  24 => 'Últimas 24 h',
  _ => 'Últimos ${hours ~/ 24} dias',
};

/// Áreas dos alertas regionais: contorno oficial (IBGE) da cidade, translúcido na cor da gravidade;
/// sem gravidade informada, cinza tracejado. Várias notícias da mesma cidade → uma área só,
/// na maior gravidade. O contorno é baixado uma vez por sessão.
class _NewsAreasLayer extends ConsumerWidget {
  const _NewsAreasLayer({required this.alerts, required this.selectedId});

  final List<NewsAlert> alerts;
  final String? selectedId;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final byRegion = <String, List<NewsAlert>>{};
    for (final a in alerts) {
      if (a.areaRegionId != null) (byRegion[a.areaRegionId!] ??= []).add(a);
    }
    final polygons = <Polygon>[];
    for (final MapEntry(key: regionId, value: list) in byRegion.entries) {
      final boundary = ref.watch(regionBoundaryProvider(regionId)).value;
      if (boundary == null) continue;
      final severities = list.map((a) => a.severity).whereType<Severity>().toList()..sort((a, b) => b.index - a.index);
      final severity = severities.firstOrNull;
      final tone = newsTone(severity);
      final selected = list.any((a) => a.id == selectedId);
      for (final p in boundary.polygons) {
        polygons.add(Polygon(
          points: p.outer,
          holePointsList: p.holes,
          color: tone.marker.withValues(alpha: selected ? 0.18 : 0.10),
          borderColor: tone.marker.withValues(alpha: selected ? 0.9 : 0.6),
          borderStrokeWidth: selected ? 3 : 2,
          pattern: severity == null ? StrokePattern.dashed(segments: const [10, 6]) : const StrokePattern.solid(),
        ));
      }
    }
    return PolygonLayer(polygons: polygons);
  }
}
