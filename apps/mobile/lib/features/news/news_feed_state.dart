import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:shared_preferences/shared_preferences.dart';

import '../../core/network/api_exception.dart';
import '../../core/providers.dart';
import '../../data/news_repository.dart';
import '../../domain/models.dart';
import '../../domain/news.dart';

/// Filtros da tela "Notícias e monitoramento" (wireframe 7.9). Aplicados pela API.
class NewsFeedFilters {
  const NewsFeedFilters({
    this.cityIbge,
    this.cityName,
    this.periodHours = defaultPeriodHours,
    this.severities = const {},
    this.sourceKey,
    this.sourceName,
    this.levels = const {},
  });

  static const defaultPeriodHours = 72;
  static const periods = [24, 72, 168];

  final String? cityIbge;
  final String? cityName;
  final int periodHours;
  final Set<Severity> severities;
  final String? sourceKey;
  final String? sourceName;
  final Set<NewsAlertLevel> levels;

  bool get isDefault => cityIbge == null && periodHours == defaultPeriodHours && severities.isEmpty && sourceKey == null && levels.isEmpty;

  NewsFeedFilters copyWith({
    ({String ibge, String name})? Function()? city,
    int? periodHours,
    Set<Severity>? severities,
    ({String key, String name})? Function()? source,
    Set<NewsAlertLevel>? levels,
  }) {
    final c = city == null ? (cityIbge == null ? null : (ibge: cityIbge!, name: cityName ?? '')) : city();
    final s = source == null ? (sourceKey == null ? null : (key: sourceKey!, name: sourceName ?? '')) : source();
    return NewsFeedFilters(
      cityIbge: c?.ibge,
      cityName: c?.name,
      periodHours: periodHours ?? this.periodHours,
      severities: severities ?? this.severities,
      sourceKey: s?.key,
      sourceName: s?.name,
      levels: levels ?? this.levels,
    );
  }

  /// Histórico (`scope=all`): em vigor + encerrados + sem atualizações; retirados nunca aparecem.
  Map<String, dynamic> toQuery({int page = 1, int limit = NewsFeedNotifier.pageSize}) => {
        'scope': 'all',
        'sort': 'recent',
        'periodHours': periodHours,
        'cityIbge': ?cityIbge,
        'source': ?sourceKey,
        if (severities.isNotEmpty) 'severity': severities.map((s) => s.api).join(','),
        if (levels.isNotEmpty) 'level': levels.map((l) => l.api).join(','),
        'page': page,
        'limit': limit,
      };

  /// Identifica a consulta no cache local (dados salvos só valem para os mesmos filtros).
  String get cacheKey => jsonEncode(toQuery()..remove('page'));
}

class NewsFeedFiltersNotifier extends Notifier<NewsFeedFilters> {
  @override
  NewsFeedFilters build() => const NewsFeedFilters();

  void set(NewsFeedFilters filters) => state = filters;
  void reset() => state = const NewsFeedFilters();
}

final newsFeedFiltersProvider = NotifierProvider<NewsFeedFiltersNotifier, NewsFeedFilters>(NewsFeedFiltersNotifier.new);

/// Página carregada. `savedAt` != null = dados salvos no aparelho (sem internet).
class NewsFeed {
  const NewsFeed({required this.items, required this.total, required this.page, required this.limit, this.savedAt});

  final List<NewsAlert> items;
  final int total;
  final int page;
  final int limit;
  final DateTime? savedAt;

  bool get fromCache => savedAt != null;
  bool get hasMore => !fromCache && page * limit < total;
}

/// Lista paginada com cache da 1ª página: sem internet, mostra a última consulta salva com aviso.
class NewsFeedNotifier extends AsyncNotifier<NewsFeed> {
  static const pageSize = 20;
  static const cacheKey = 'news_feed_cache_v1';

  NewsRepository get _repo => ref.read(newsRepositoryProvider);

  @override
  Future<NewsFeed> build() async {
    final filters = ref.watch(newsFeedFiltersProvider);
    try {
      final json = await _repo.listJson(filters.toQuery());
      await _save(filters, json);
      return _parse(json);
    } on ApiException catch (e) {
      if (!e.isConnectivity) rethrow;
      final saved = await _load(filters);
      if (saved == null) rethrow;
      return saved;
    }
  }

  Future<void> loadMore() async {
    final current = state.value;
    if (current == null || !current.hasMore) return;
    final filters = ref.read(newsFeedFiltersProvider);
    final next = _parse(await _repo.listJson(filters.toQuery(page: current.page + 1)));
    state = AsyncData(NewsFeed(items: [...current.items, ...next.items], total: next.total, page: next.page, limit: next.limit));
  }

  static NewsFeed _parse(Map<String, dynamic> json, {DateTime? savedAt}) {
    final page = Paged.fromJson(json, NewsAlert.fromJson);
    return NewsFeed(items: page.items, total: page.total, page: page.page, limit: page.limit, savedAt: savedAt);
  }

  Future<void> _save(NewsFeedFilters filters, Map<String, dynamic> json) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(cacheKey, jsonEncode({'key': filters.cacheKey, 'savedAt': DateTime.now().toUtc().toIso8601String(), 'body': json}));
    } catch (_) {
      // cache é opcional: falha ao gravar não impede mostrar os dados
    }
  }

  Future<NewsFeed?> _load(NewsFeedFilters filters) async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final raw = prefs.getString(cacheKey);
      if (raw == null) return null;
      final saved = jsonDecode(raw) as Map<String, dynamic>;
      if (saved['key'] != filters.cacheKey) return null;
      return _parse(saved['body'] as Map<String, dynamic>, savedAt: DateTime.parse(saved['savedAt'] as String).toLocal());
    } catch (_) {
      return null; // cache corrompido ou de versão antiga: trata como inexistente
    }
  }
}

/// Sem repetição automática do Riverpod 3: a falha aparece na hora (com "Tentar novamente") e,
/// sem internet, os dados salvos já cobrem — repetir escondia o estado de erro atrás de "carregando".
final newsFeedProvider = AsyncNotifierProvider.autoDispose<NewsFeedNotifier, NewsFeed>(NewsFeedNotifier.new, retry: (_, _) => null);

/// Opções dos filtros (cidades monitoradas e fontes). Mudam raramente: mantidas na sessão.
final newsFilterOptionsProvider = FutureProvider<NewsFilterOptions>((ref) => ref.read(newsRepositoryProvider).filters());

/// Quantos alertas de notícia estão em vigor nas cidades monitoradas (cartão da central de Alertas).
final activeNewsCountProvider = FutureProvider.autoDispose<int>((ref) async {
  final page = await ref.read(newsRepositoryProvider).list(limit: 1);
  return page.total;
});
