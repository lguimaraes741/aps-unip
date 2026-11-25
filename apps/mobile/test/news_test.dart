import 'dart:io';

import 'package:alertacidade/core/location/location_service.dart';
import 'package:alertacidade/core/providers.dart';
import 'package:alertacidade/core/theme/app_theme.dart';
import 'package:alertacidade/data/news_repository.dart';
import 'package:alertacidade/data/occurrences_repository.dart';
import 'package:alertacidade/domain/models.dart';
import 'package:alertacidade/domain/news.dart';
import 'package:alertacidade/features/map/map_page.dart';
import 'package:alertacidade/features/news/news_detail_page.dart';
import 'package:alertacidade/features/news/news_widgets.dart';
import 'package:flutter/services.dart';
import 'package:flutter_map/flutter_map.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:latlong2/latlong.dart';
import 'package:material_ui/material_ui.dart';

const se = LatLng(-23.55052, -46.63331);
const pointId = '11111111-1111-4111-8111-111111111111';
const regionalId = '22222222-2222-4222-8222-222222222222';
const regionId = '33333333-3333-4333-8333-333333333333';

/// Formato devolvido por `GET /news/events` (apps/api/src/news/news-public.service.ts).
Map<String, dynamic> newsJson({Map<String, dynamic> overrides = const {}}) => {
      'id': pointId,
      'alertId': 'a1',
      'code': 12,
      'eventType': 'FLOODING',
      'title': 'Chuva alaga avenida e interdita via',
      'headline': 'via interditada',
      'level': 'PRELIMINARY',
      'isOfficial': false,
      'status': 'ACTIVE',
      'severity': 'HIGH',
      'city': 'São Paulo',
      'state': 'SP',
      'regionName': 'Sé',
      'placeText': 'Av. do Estado',
      'locationPrecision': 'STREET',
      'latitude': -23.545,
      'longitude': -46.6333,
      'areaRegionId': null,
      'center': null,
      'independentSources': 1,
      'articleCount': 2,
      'sourceCount': 2,
      'primarySource': {
        'name': 'G1',
        'reliability': 'ESTABLISHED_PRESS',
        'title': 'Chuva alaga avenida',
        'url': 'https://g1.globo.com/sp/noticia/1',
        'publishedAt': '2026-11-24T17:20:00.000Z',
        'summary': 'Trecho interditado.',
      },
      'reviewedByModerator': false,
      'eventOccurredAt': null,
      'firstEvidenceAt': '2026-11-24T17:20:00.000Z',
      'lastEvidenceAt': '2026-11-24T17:40:00.000Z',
      'publishedAt': '2026-11-24T17:21:00.000Z',
      'expiresAt': '2026-11-24T23:40:00.000Z',
      'updatedAt': '2026-11-24T17:41:00.000Z',
      'distanceMeters': 560,
      ...overrides,
    };

Map<String, dynamic> regionalJson() => newsJson(overrides: {
      'id': regionalId,
      'code': 13,
      'title': 'Alagamentos em Osasco',
      'severity': null,
      'headline': null,
      'level': 'VERIFIED',
      'independentSources': 2,
      'city': 'Osasco',
      'regionName': 'Osasco',
      'placeText': null,
      'locationPrecision': 'CITY',
      'latitude': null,
      'longitude': null,
      'areaRegionId': regionId,
      'center': {'latitude': -23.56, 'longitude': -46.64},
    });

class FakeNews extends Fake implements NewsRepository {
  List<Map<String, dynamic>> items = [newsJson(), regionalJson()];
  int listCalls = 0;
  final details = <String, Map<String, dynamic>>{};

  @override
  Future<Paged<NewsAlert>> list({
    double? lat,
    double? lng,
    int? radiusMeters,
    bool activeOnly = true,
    Set<Severity> severities = const {},
    int? periodHours,
    int page = 1,
    int limit = 50,
  }) async {
    listCalls++;
    return Paged(items: items.map(NewsAlert.fromJson).toList(), total: items.length, page: 1, limit: limit);
  }

  @override
  Future<NewsAlertDetail> detail(String id) async => NewsAlertDetail.fromJson(details[id]!);

  @override
  Future<RegionBoundary> boundary(String regionId) async => RegionBoundary.fromJson({
        'regionId': regionId,
        'name': 'Osasco',
        'kind': 'CITY',
        'geometry': {
          'type': 'MultiPolygon',
          'coordinates': [
            [
              [[-46.65, -23.57], [-46.63, -23.57], [-46.63, -23.55], [-46.65, -23.55], [-46.65, -23.57]],
            ],
          ],
        },
      });
}

class FakeOccurrences extends Fake implements OccurrencesRepository {
  @override
  Future<Paged<OccurrenceSummary>> list(OccurrenceFilters filters, {double? lat, double? lng, int page = 1, int limit = 50}) async =>
      const Paged(items: [], total: 0, page: 1, limit: 100);
}

class FakeLocation implements LocationService {
  @override
  Future<LocationResult> current({bool request = true}) async => const LocationResult(LocationStatus.granted, se);
  @override
  Future<bool> openSettings() async => true;
}

/// Os tiles do mapa nunca carregam no teste (sem rede), então `pumpAndSettle` não serve:
/// avança as animações (resumo, painel) e mais alguns quadros para o layout acompanhar.
Future<void> settleMap(WidgetTester tester) async {
  for (var i = 0; i < 10; i++) {
    await tester.pump(const Duration(milliseconds: 100));
  }
}

void main() {
  setUpAll(() async {
    await initializeDateFormatting('pt_BR');
    // Cache de tiles do flutter_map usa o path_provider (plugin nativo): pasta temporária no teste.
    final cacheDir = Directory.systemTemp.createTempSync('alertacidade_tiles_news');
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(
      const MethodChannel('plugins.flutter.io/path_provider'),
      (_) async => cacheDir.path,
    );
  });

  group('modelos', () {
    test('alerta com ponto: gravidade, nível, fonte principal e rótulos', () {
      final a = NewsAlert.fromJson(newsJson());
      expect(a.severity, Severity.high);
      expect(a.level, NewsAlertLevel.preliminary);
      expect(a.point, const LatLng(-23.545, -46.6333));
      expect(a.isRegional, isFalse);
      expect(a.anchor, a.point);
      expect(a.placeLabel, 'Av. do Estado, Sé, São Paulo');
      expect(newsSourcesLabel(a), 'G1 (+1)');
      expect(newsOriginText(a), 'Notícia ainda não confirmada. Não é comunicado oficial.');
    });

    test('alerta regional sem gravidade: área + centro; nunca vira "baixa"', () {
      final a = NewsAlert.fromJson(regionalJson());
      expect(a.severity, isNull);
      expect(a.isRegional, isTrue);
      expect(a.anchor, const LatLng(-23.56, -46.64));
      expect(a.placeLabel, 'Osasco');
      expect(newsSeverityLabel(a.severity), 'Gravidade não informada');
      expect(newsOriginText(a), 'Confirmado por 2 fontes independentes. Não é comunicado oficial.');
    });

    test('verificado só pela moderação e comunicado oficial dizem a origem certa', () {
      final moderated = NewsAlert.fromJson(newsJson(overrides: {'level': 'VERIFIED', 'independentSources': 1, 'reviewedByModerator': true}));
      expect(newsOriginText(moderated), 'Conferido pela moderação. Não é comunicado oficial.');
      final official = NewsAlert.fromJson(newsJson(overrides: {
        'level': 'OFFICIAL',
        'primarySource': {'name': 'Defesa Civil SP', 'reliability': 'OFFICIAL'},
      }));
      expect(official.isOfficial, isTrue);
      expect(newsOriginText(official), 'Comunicado oficial publicado por Defesa Civil SP.');
      expect(newsIcon(official), Icons.account_balance);
    });

    test('valores desconhecidos (API futura) caem no caso conservador sem quebrar', () {
      final a = NewsAlert.fromJson(newsJson(overrides: {'level': 'SUPER_VERIFIED', 'status': 'ARCHIVED', 'severity': 'EXTREME'}));
      expect(a.level, NewsAlertLevel.preliminary);
      expect(a.status, isNot(NewsAlertStatus.active));
      expect(a.severity, isNull);
    });

    test('contorno: MultiPolygon com furo e Polygon simples; GeoJSON é [lng, lat]', () {
      final multi = RegionBoundary.fromJson({
        'regionId': regionId,
        'name': 'X',
        'geometry': {
          'type': 'MultiPolygon',
          'coordinates': [
            [
              [[-46.7, -23.6], [-46.5, -23.6], [-46.5, -23.4], [-46.7, -23.6]],
              [[-46.65, -23.55], [-46.6, -23.55], [-46.6, -23.5], [-46.65, -23.55]],
            ],
            [
              [[-46.9, -23.6], [-46.8, -23.6], [-46.8, -23.5], [-46.9, -23.6]],
            ],
          ],
        },
      });
      expect(multi.polygons, hasLength(2));
      expect(multi.polygons.first.outer.first, const LatLng(-23.6, -46.7));
      expect(multi.polygons.first.holes, hasLength(1));
      final single = RegionBoundary.fromJson({
        'regionId': regionId,
        'name': 'X',
        'geometry': {
          'type': 'Polygon',
          'coordinates': [
            [[-46.7, -23.6], [-46.5, -23.6], [-46.5, -23.4], [-46.7, -23.6]],
          ],
        },
      });
      expect(single.polygons, hasLength(1));
      expect(single.polygons.first.holes, isEmpty);
    });

    test('detalhe: fontes, independência e motivo da retirada', () {
      final d = NewsAlertDetail.fromJson({
        ...newsJson(overrides: {'status': 'RETRACTED'}),
        'retractionReason': 'Notícia desmentida',
        'sources': [
          {'id': 's1', 'title': 'Matéria 1', 'sourceName': 'G1', 'url': 'https://g1.globo.com/1', 'publishedAt': '2026-11-24T17:20:00.000Z', 'independent': true},
          {'id': 's2', 'title': 'Matéria 2', 'sourceName': 'R7', 'url': null, 'publishedAt': null, 'independent': false},
        ],
      });
      expect(d.alert.status, NewsAlertStatus.retracted);
      expect(d.retractionReason, 'Notícia desmentida');
      expect(d.sources.map((s) => s.independent), [true, false]);
      expect(d.sources[1].url, isNull);
    });
  });

  group('camada de notícias no mapa', () {
    late FakeNews news;

    Future<void> pumpMap(WidgetTester tester) async {
      tester.view.physicalSize = const Size(1080, 2400);
      tester.view.devicePixelRatio = 2.625;
      addTearDown(tester.view.reset);
      final router = GoRouter(
        initialLocation: '/map',
        routes: [
          GoRoute(path: '/map', builder: (_, _) => const MapPage()),
          GoRoute(path: '/news/:id', builder: (_, state) => NewsDetailPage(id: state.pathParameters['id']!)),
        ],
      );
      await tester.pumpWidget(ProviderScope(
        overrides: [
          newsRepositoryProvider.overrideWithValue(news),
          occurrencesRepositoryProvider.overrideWithValue(FakeOccurrences()),
          locationServiceProvider.overrideWithValue(FakeLocation()),
        ],
        child: MaterialApp.router(theme: AppTheme.light(), routerConfig: router),
      ));
      await tester.pump();
      await tester.pump(const Duration(milliseconds: 500));
    }

    setUp(() {
      news = FakeNews();
      news.details[pointId] = {
        ...newsJson(),
        'retractionReason': null,
        'sources': [
          {'id': 's1', 'title': 'Chuva alaga avenida', 'sourceName': 'G1', 'url': 'https://g1.globo.com/1', 'publishedAt': '2026-11-24T17:20:00.000Z', 'independent': true},
          {'id': 's2', 'title': 'Avenida interditada', 'sourceName': 'R7', 'url': 'https://r7.com/2', 'publishedAt': '2026-11-24T17:30:00.000Z', 'independent': false},
        ],
      };
    });

    testWidgets('mostra marcador de rua, rótulo e área do alerta regional (cinza tracejado sem gravidade)', (tester) async {
      await pumpMap(tester);
      expect(find.byType(NewsMarker), findsNWidgets(2));
      final layers = tester.widgetList<PolygonLayer>(find.byType(PolygonLayer)).toList();
      final polygons = layers.expand((l) => l.polygons).toList();
      expect(polygons, hasLength(1));
      expect(polygons.single.points.first, const LatLng(-23.57, -46.65));
      expect(polygons.single.pattern, isNot(const StrokePattern.solid()));
      expect(find.bySemanticsLabel(RegExp('Alerta de notícia, gravidade alta, preliminar')), findsOneWidget);
    });

    testWidgets('tocar no marcador abre o resumo; "Detalhes" abre a tela com todas as fontes', (tester) async {
      await pumpMap(tester);
      await tester.tap(find.byKey(const ValueKey('news-marker-$pointId')));
      await settleMap(tester); // resumo + painel recolhendo
      expect(find.byType(NewsSummaryCard), findsOneWidget);
      expect(find.text('Fonte: G1 (+1)'), findsOneWidget);
      expect(find.text('Notícia ainda não confirmada. Não é comunicado oficial.'), findsOneWidget);
      expect(find.textContaining('Notícia · Gravidade alta · Preliminar'), findsOneWidget);

      await tester.tap(find.text('Detalhes'));
      await tester.pumpAndSettle();
      expect(find.byType(NewsDetailPage), findsOneWidget);
      expect(find.text('Fontes (2)'), findsOneWidget);
      expect(find.text('Avenida interditada'), findsOneWidget);
      expect(find.textContaining('Republicação ou mesma agência'), findsOneWidget);
    });

    testWidgets('chip "Notícias" esconde e mostra a camada', (tester) async {
      await pumpMap(tester);
      expect(find.byType(NewsMarker), findsNWidgets(2));
      await tester.tap(find.widgetWithText(ActionChip, 'Notícias'));
      await tester.pump(const Duration(milliseconds: 400));
      expect(find.byType(NewsMarker), findsNothing);
      final calls = news.listCalls;
      await tester.tap(find.widgetWithText(ActionChip, 'Notícias'));
      await tester.pump(const Duration(milliseconds: 400));
      expect(find.byType(NewsMarker), findsNWidgets(2));
      expect(news.listCalls, greaterThan(calls));
    });

    testWidgets('tocar no mapa vazio fecha o resumo', (tester) async {
      await pumpMap(tester);
      await tester.tap(find.byKey(const ValueKey('news-marker-$regionalId')));
      await settleMap(tester);
      expect(find.text('Alagamentos em Osasco'), findsOneWidget);
      await tester.tap(find.byTooltip('Fechar resumo'));
      await settleMap(tester);
      expect(find.byType(NewsSummaryCard), findsNothing);
    });
  });

  testWidgets('detalhe de alerta retirado mostra o motivo', (tester) async {
    final news = FakeNews()
      ..details[pointId] = {
        ...newsJson(overrides: {'status': 'RETRACTED'}),
        'retractionReason': 'Notícia desmentida pela prefeitura',
        'sources': const [],
      };
    await tester.pumpWidget(ProviderScope(
      overrides: [newsRepositoryProvider.overrideWithValue(news)],
      child: MaterialApp(theme: AppTheme.light(), home: const NewsDetailPage(id: pointId)),
    ));
    await tester.pumpAndSettle();
    expect(find.text('Alerta retirado'), findsOneWidget);
    expect(find.text('Notícia desmentida pela prefeitura'), findsOneWidget);
  });
}
