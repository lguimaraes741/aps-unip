import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:latlong2/latlong.dart';

import '../../core/location/location_service.dart';
import '../../core/providers.dart';
import '../../data/occurrences_repository.dart';
import '../../domain/models.dart';

class MapFiltersNotifier extends Notifier<OccurrenceFilters> {
  @override
  OccurrenceFilters build() => const OccurrenceFilters();

  void set(OccurrenceFilters filters) => state = filters;
  void setQuery(String query) => state = state.copyWith(query: () => query.trim().isEmpty ? null : query.trim());
  void reset() => state = OccurrenceFilters(query: state.query);
}

final mapFiltersProvider = NotifierProvider<MapFiltersNotifier, OccurrenceFilters>(MapFiltersNotifier.new);

/// Ponto de referência da consulta por raio: localização do usuário (com consentimento)
/// ou a área que ele escolheu no mapa ("Buscar nesta área").
class SearchArea {
  const SearchArea(this.center, {this.fromUserLocation = false});

  final LatLng center;
  final bool fromUserLocation;
}

class SearchAreaNotifier extends Notifier<SearchArea> {
  @override
  SearchArea build() => const SearchArea(defaultMapCenter);

  void set(SearchArea area) => state = area;
}

final searchAreaProvider = NotifierProvider<SearchAreaNotifier, SearchArea>(SearchAreaNotifier.new);

/// Última localização obtida do usuário (nula até ele permitir).
class UserLocationNotifier extends Notifier<LocationResult?> {
  @override
  LocationResult? build() => null;

  Future<LocationResult> locate({bool request = true}) async {
    final result = await ref.read(locationServiceProvider).current(request: request);
    state = result;
    if (result.ok) ref.read(searchAreaProvider.notifier).set(SearchArea(result.position!, fromUserLocation: true));
    return result;
  }
}

final userLocationProvider = NotifierProvider<UserLocationNotifier, LocationResult?>(UserLocationNotifier.new);

/// Ocorrências da área — consulta real à API (PostGIS), refeita quando filtros ou área mudam.
final nearbyOccurrencesProvider = FutureProvider.autoDispose<Paged<OccurrenceSummary>>((ref) {
  final filters = ref.watch(mapFiltersProvider);
  final area = ref.watch(searchAreaProvider);
  return ref.read(occurrencesRepositoryProvider).list(filters, lat: area.center.latitude, lng: area.center.longitude, limit: 100);
});

class SelectedOccurrenceNotifier extends Notifier<String?> {
  @override
  String? build() => null;

  void select(String? id) => state = id;
}

final selectedOccurrenceProvider = NotifierProvider<SelectedOccurrenceNotifier, String?>(SelectedOccurrenceNotifier.new);
