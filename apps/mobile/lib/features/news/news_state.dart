import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/providers.dart';
import '../../domain/news.dart';
import '../map/map_state.dart';

/// Camada "Notícias" do mapa (ligada por padrão; o usuário pode esconder).
class NewsLayerNotifier extends Notifier<bool> {
  @override
  bool build() => true;

  void toggle() => state = !state;
}

final newsLayerProvider = NotifierProvider<NewsLayerNotifier, bool>(NewsLayerNotifier.new);

/// Alertas de notícia EM VIGOR na área do mapa. Usa o mesmo raio, gravidade e período dos
/// relatos (status e busca por texto são próprios dos relatos e não se aplicam).
/// Alerta regional entra quando o contorno da cidade cruza o raio — mesmo critério do push.
final nearbyNewsProvider = FutureProvider.autoDispose<List<NewsAlert>>((ref) async {
  if (!ref.watch(newsLayerProvider)) return const [];
  final filters = ref.watch(mapFiltersProvider);
  final area = ref.watch(searchAreaProvider);
  final page = await ref.read(newsRepositoryProvider).list(
        lat: area.center.latitude,
        lng: area.center.longitude,
        radiusMeters: filters.radiusMeters,
        severities: filters.severities,
        periodHours: filters.periodHours,
        limit: 100,
      );
  return page.items;
});

/// Contorno da região (dado público e estável): fica em memória durante a sessão.
final regionBoundaryProvider = FutureProvider.family<RegionBoundary, String>(
  (ref, regionId) => ref.read(newsRepositoryProvider).boundary(regionId),
);

final newsDetailProvider = FutureProvider.autoDispose.family<NewsAlertDetail, String>(
  (ref, id) => ref.read(newsRepositoryProvider).detail(id),
);

/// Alerta de notícia selecionado no mapa (exclusivo com a ocorrência selecionada).
class SelectedNewsNotifier extends Notifier<String?> {
  @override
  String? build() => null;

  void select(String? id) => state = id;
}

final selectedNewsProvider = NotifierProvider<SelectedNewsNotifier, String?>(SelectedNewsNotifier.new);
