import 'dart:async';

import 'package:alertacidade/core/network/api_exception.dart';
import 'package:alertacidade/core/providers.dart';
import 'package:alertacidade/core/theme/app_theme.dart';
import 'package:alertacidade/data/news_repository.dart';
import 'package:alertacidade/domain/models.dart';
import 'package:alertacidade/domain/news.dart';
import 'package:alertacidade/features/news/news_detail_page.dart';
import 'package:alertacidade/features/news/news_monitor_page.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:go_router/go_router.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:material_ui/material_ui.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'news_test.dart' show newsJson, pointId, regionalJson;

const offline = ApiException(ApiErrorKind.network, 'Sem conexão com o servidor. Verifique sua internet.');

/// Repositório controlável: cada chamada de `listJson` usa a próxima resposta da fila.
class ScriptedNews extends Fake implements NewsRepository {
  final queries = <Map<String, dynamic>>[];
  final responses = <FutureOr<Map<String, dynamic>> Function()>[];
  Completer<Map<String, dynamic>>? pending;

  static Map<String, dynamic> page(List<Map<String, dynamic>> items, {int total = -1, int page = 1, int limit = 20}) =>
      {'items': items, 'total': total < 0 ? items.length : total, 'page': page, 'limit': limit};

  @override
  Future<Map<String, dynamic>> listJson(Map<String, dynamic> query) async {
    queries.add(query);
    final next = responses.isEmpty ? (() => page(const [])) : responses.removeAt(0);
    return await next();
  }

  @override
  Future<NewsFilterOptions> filters() async => NewsFilterOptions.fromJson({
        'cities': [
          {'ibge': '3534401', 'name': 'Osasco'},
          {'ibge': '3550308', 'name': 'São Paulo'},
        ],
        'sources': [
          {'key': 'g1-sp', 'name': 'G1 SP', 'official': false},
          {'key': 'defesa-civil-sp', 'name': 'Defesa Civil SP', 'official': true},
        ],
      });

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
  }) async =>
      const Paged(items: [], total: 3, page: 1, limit: 1);

  @override
  Future<NewsAlertDetail> detail(String id) async => NewsAlertDetail.fromJson({...newsJson(), 'retractionReason': null, 'sources': const []});
}

void main() {
  setUpAll(() => initializeDateFormatting('pt_BR'));

  late ScriptedNews news;

  setUp(() {
    SharedPreferences.setMockInitialValues({});
    news = ScriptedNews();
  });

  Future<void> pump(WidgetTester tester) async {
    tester.view.physicalSize = const Size(1080, 2400);
    tester.view.devicePixelRatio = 2.625;
    addTearDown(tester.view.reset);
    final router = GoRouter(initialLocation: '/news', routes: [
      GoRoute(path: '/news', builder: (_, _) => const NewsMonitorPage()),
      GoRoute(path: '/news/:id', builder: (_, s) => NewsDetailPage(id: s.pathParameters['id']!)),
    ]);
    await tester.pumpWidget(ProviderScope(
      overrides: [newsRepositoryProvider.overrideWithValue(news)],
      child: MaterialApp.router(theme: AppTheme.light(), routerConfig: router),
    ));
  }

  testWidgets('carregando: esqueleto enquanto a API não responde; depois os cartões', (tester) async {
    final completer = Completer<Map<String, dynamic>>();
    news.responses.add(() => completer.future);
    await pump(tester);
    await tester.pump();
    expect(find.bySemanticsLabel('Carregando'), findsOneWidget);
    completer.complete(ScriptedNews.page([newsJson(), regionalJson()]));
    await tester.pumpAndSettle();
    expect(find.byType(NewsFeedCard), findsNWidgets(2));
    // Histórico recente (em vigor + encerrados), mais novos primeiro, últimos 3 dias por padrão.
    expect(news.queries.first, {'scope': 'all', 'sort': 'recent', 'periodHours': 72, 'page': 1, 'limit': 20});
  });

  testWidgets('vazio: mensagem das regiões monitoradas; com filtro, oferece limpar', (tester) async {
    await pump(tester);
    await tester.pumpAndSettle();
    expect(find.text('Nenhuma notícia de alagamento nas regiões monitoradas'), findsOneWidget);

    await tester.tap(find.text('Cidade'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Osasco'));
    await tester.pumpAndSettle();
    expect(news.queries.last['cityIbge'], '3534401');
    expect(find.text('Nenhuma notícia com estes filtros'), findsOneWidget);
    await tester.tap(find.widgetWithText(OutlinedButton, 'Limpar filtros'));
    await tester.pumpAndSettle();
    expect(news.queries.last.containsKey('cityIbge'), isFalse);
    expect(find.text('Nenhuma notícia de alagamento nas regiões monitoradas'), findsOneWidget);
  });

  testWidgets('falha do servidor: erro com "Tentar novamente", que refaz a consulta', (tester) async {
    news.responses.add(() => throw const ApiException(ApiErrorKind.server, 'Erro interno. Tente mais tarde.'));
    news.responses.add(() => ScriptedNews.page([newsJson()]));
    await pump(tester);
    await tester.pumpAndSettle();
    expect(find.text('Algo deu errado'), findsOneWidget);
    await tester.tap(find.text('Tentar novamente'));
    await tester.pumpAndSettle();
    expect(find.byType(NewsFeedCard), findsOneWidget);
  });

  testWidgets('sem internet: mostra as notícias salvas da mesma consulta, com aviso; sem dados salvos, "Sem conexão"', (tester) async {
    news.responses.add(() => ScriptedNews.page([newsJson()]));
    news.responses.add(() => throw offline);
    await pump(tester);
    await tester.pumpAndSettle();
    expect(find.byType(NewsFeedCard), findsOneWidget);

    // Recarrega (puxar para atualizar) já sem internet.
    await tester.fling(find.byType(ListView).first, const Offset(0, 400), 1000);
    await tester.pumpAndSettle();
    expect(find.textContaining('Sem conexão. Mostrando as notícias salvas em'), findsOneWidget);
    expect(find.byType(NewsFeedCard), findsOneWidget);
    expect(find.text('Carregar mais'), findsNothing); // dados salvos não paginam

    // Outra consulta (outro período) não tem dados salvos: não mostra a lista errada.
    news.responses.add(() => throw offline);
    await tester.tap(find.text('Últimos 3 dias'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Últimas 24 h'));
    await tester.pumpAndSettle();
    expect(find.text('Sem conexão'), findsOneWidget);
    expect(find.byType(NewsFeedCard), findsNothing);
  });

  testWidgets('cartão: gravidade, "Recente", verificação, fonte · data · cidade, resumo, nº de fontes; encerrado mostra a situação', (tester) async {
    final now = DateTime.now().toUtc();
    news.responses.add(() => ScriptedNews.page([
          newsJson(overrides: {'lastEvidenceAt': now.subtract(const Duration(minutes: 20)).toIso8601String()}),
          regionalJson()
            ..['status'] = 'RESOLVED'
            ..['id'] = 'r1'
            ..['primarySource'] = {'name': 'R7', 'reliability': 'ESTABLISHED_PRESS', 'url': null, 'publishedAt': '2026-11-24T17:20:00.000Z'},
        ]));
    await pump(tester);
    await tester.pumpAndSettle();
    final first = find.byType(NewsFeedCard).first;
    expect(find.descendant(of: first, matching: find.text('Alta')), findsOneWidget);
    expect(find.descendant(of: first, matching: find.text('Recente')), findsOneWidget);
    expect(find.descendant(of: first, matching: find.text('Preliminar')), findsOneWidget);
    expect(find.descendant(of: first, matching: find.textContaining('G1 · ')), findsOneWidget);
    expect(find.descendant(of: first, matching: find.textContaining('· São Paulo')), findsOneWidget);
    expect(find.descendant(of: first, matching: find.text('Trecho interditado.')), findsOneWidget);
    expect(find.descendant(of: first, matching: find.text('2 fontes')), findsOneWidget);

    final second = find.byType(NewsFeedCard).last;
    expect(find.descendant(of: second, matching: find.text('Encerrado')), findsOneWidget);
    expect(find.descendant(of: second, matching: find.text('Não informada')), findsOneWidget);
    expect(find.descendant(of: second, matching: find.text('Recente')), findsNothing);
    // Sem link da fonte: botão desabilitado (nunca abre algo inválido).
    final button = tester.widget<TextButton>(find.descendant(of: second, matching: find.byType(TextButton)));
    expect(button.onPressed, isNull);
  });

  testWidgets('filtros múltiplos (gravidade, verificação, fonte) vão para a API; tocar no cartão abre os detalhes', (tester) async {
    news.responses.addAll(List.filled(5, () => ScriptedNews.page([newsJson()])));
    await pump(tester);
    await tester.pumpAndSettle();

    await tester.ensureVisible(find.text('Gravidade'));
    await tester.tap(find.text('Gravidade'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(CheckboxListTile, 'Crítica'));
    await tester.tap(find.widgetWithText(CheckboxListTile, 'Alta'));
    await tester.tap(find.text('Aplicar'));
    await tester.pumpAndSettle();
    expect(news.queries.last['severity'], 'CRITICAL,HIGH');

    await tester.ensureVisible(find.text('Verificação'));
    await tester.tap(find.text('Verificação'));
    await tester.pumpAndSettle();
    await tester.tap(find.widgetWithText(CheckboxListTile, 'Comunicado oficial'));
    await tester.tap(find.text('Aplicar'));
    await tester.pumpAndSettle();
    expect(news.queries.last['level'], 'OFFICIAL');

    await tester.ensureVisible(find.text('Fonte'));
    await tester.tap(find.text('Fonte'));
    await tester.pumpAndSettle();
    await tester.tap(find.text('Defesa Civil SP (oficial)'));
    await tester.pumpAndSettle();
    expect(news.queries.last['source'], 'defesa-civil-sp');
    expect(find.text('Defesa Civil SP'), findsOneWidget); // a pílula mostra a fonte escolhida

    await tester.tap(find.byType(NewsFeedCard));
    await tester.pumpAndSettle();
    expect(find.byType(NewsDetailPage), findsOneWidget);
    expect(find.textContaining('N-12'), findsOneWidget);
  });

  testWidgets('"Carregar mais" busca a próxima página e junta à lista', (tester) async {
    news.responses.add(() => ScriptedNews.page([newsJson()], total: 2, limit: 1));
    news.responses.add(() => ScriptedNews.page([regionalJson()], total: 2, page: 2, limit: 1));
    await pump(tester);
    await tester.pumpAndSettle();
    expect(find.byType(NewsFeedCard), findsOneWidget);
    await tester.ensureVisible(find.text('Carregar mais'));
    await tester.tap(find.text('Carregar mais'));
    await tester.pumpAndSettle();
    expect(news.queries.last['page'], 2);
    expect(find.byType(NewsFeedCard), findsNWidgets(2));
    expect(find.text('Carregar mais'), findsNothing);
    expect(pointId, isNotEmpty);
  });
}
