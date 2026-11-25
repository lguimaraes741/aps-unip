import '../core/network/api_client.dart';
import '../domain/models.dart';
import '../domain/news.dart';

/// Opções dos filtros da tela de notícias (`GET /news/filters`).
class NewsFilterOptions {
  const NewsFilterOptions({required this.cities, required this.sources});

  final List<({String ibge, String name})> cities;
  final List<({String key, String name, bool official})> sources;

  factory NewsFilterOptions.fromJson(Map<String, dynamic> json) => NewsFilterOptions(
        cities: [
          for (final c in (json['cities'] as List<dynamic>? ?? const []).cast<Map<String, dynamic>>())
            (ibge: c['ibge'] as String, name: c['name'] as String),
        ],
        sources: [
          for (final s in (json['sources'] as List<dynamic>? ?? const []).cast<Map<String, dynamic>>())
            (key: s['key'] as String, name: s['name'] as String, official: s['official'] as bool? ?? false),
        ],
      );
}

/// Leitura dos alertas de notícia publicados (`GET /news/*`). O app nunca vê o que está em moderação.
class NewsRepository {
  NewsRepository(this._api);

  final ApiClient _api;

  Future<Paged<NewsAlert>> list({
    double? lat,
    double? lng,
    int? radiusMeters,
    bool activeOnly = true,
    Set<Severity> severities = const {},
    int? periodHours,
    int page = 1,
    int limit = 50,
  }) async =>
      Paged.fromJson(
        await listJson({
          if (lat != null && lng != null) ...{'lat': lat, 'lng': lng, 'radius': ?radiusMeters},
          'scope': activeOnly ? 'active' : 'all',
          if (severities.isNotEmpty) 'severity': severities.map((s) => s.api).join(','),
          'periodHours': ?periodHours,
          'page': page,
          'limit': limit,
        }),
        NewsAlert.fromJson,
      );

  /// Resposta crua de `GET /news/events` (a tela de notícias guarda a última para usar sem internet).
  Future<Map<String, dynamic>> listJson(Map<String, dynamic> query) =>
      _api.call((dio) => dio.get<dynamic>('/news/events', queryParameters: query), (d) => d as Map<String, dynamic>);

  Future<NewsFilterOptions> filters() =>
      _api.call((dio) => dio.get<dynamic>('/news/filters'), (d) => NewsFilterOptions.fromJson(d as Map<String, dynamic>));

  Future<NewsAlertDetail> detail(String id) =>
      _api.call((dio) => dio.get<dynamic>('/news/events/$id'), (d) => NewsAlertDetail.fromJson(d as Map<String, dynamic>));

  Future<RegionBoundary> boundary(String regionId) => _api.call(
        (dio) => dio.get<dynamic>('/news/regions/$regionId/boundary'),
        (d) => RegionBoundary.fromJson(d as Map<String, dynamic>),
      );
}
