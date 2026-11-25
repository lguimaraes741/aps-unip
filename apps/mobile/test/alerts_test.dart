import 'package:alertacidade/core/providers.dart';
import 'package:alertacidade/core/theme/app_theme.dart';
import 'package:alertacidade/data/notifications_repository.dart';
import 'package:alertacidade/data/users_repository.dart';
import 'package:alertacidade/domain/models.dart';
import 'package:alertacidade/features/alerts/alerts_page.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:material_ui/material_ui.dart';
import 'package:mocktail/mocktail.dart';

import 'news_monitor_test.dart' show ScriptedNews;

class MockNotificationsRepository extends Mock implements NotificationsRepository {}

class MockUsersRepository extends Mock implements UsersRepository {}

Map<String, dynamic> alertJson(String id, {String? readAt, Map<String, dynamic>? occurrence = const {'code': 42, 'severity': 'CRITICAL', 'status': 'PENDING'}}) => {
      'id': id,
      'type': 'OCCURRENCE_NEARBY',
      'occurrenceId': 'occ-$id',
      'title': 'Alagamento de gravidade crítica a 300 m (Sé)',
      'body': 'Ocorrência #42 registrada por um cidadão, ainda não verificada.',
      'distanceMeters': 300,
      'occurrence': occurrence,
      'readAt': readAt,
      'createdAt': DateTime.now().toUtc().subtract(const Duration(minutes: 5)).toIso8601String(),
    };

NotificationsPage pageOf(List<Map<String, dynamic>> items, {int unread = 0}) =>
    NotificationsPage(page: Paged(items: items.map(AppNotification.fromJson).toList(), total: items.length, page: 1, limit: 20), unread: unread);

void main() {
  setUpAll(() {
    initializeDateFormatting('pt_BR');
    registerFallbackValue(NotificationFilter.all);
  });

  late MockNotificationsRepository repo;
  late MockUsersRepository users;

  setUp(() {
    repo = MockNotificationsRepository();
    users = MockUsersRepository();
    when(() => users.preferences()).thenAnswer((_) async => NotificationPreferences.fromJson(
          {'pushEnabled': true, 'radiusMeters': 2000, 'minSeverity': 'MODERATE', 'latitude': null, 'longitude': null},
        ));
  });

  Future<void> pump(WidgetTester tester) async {
    await tester.pumpWidget(ProviderScope(
      overrides: [
        notificationsRepositoryProvider.overrideWithValue(repo),
        usersRepositoryProvider.overrideWithValue(users),
        newsRepositoryProvider.overrideWithValue(ScriptedNews()), // 3 alertas de notícia em vigor
      ],
      child: MaterialApp(theme: AppTheme.light(), home: const AlertsPage()),
    ));
    await tester.pumpAndSettle();
  }

  testWidgets('entrada "Notícias e monitoramento" na central, com quantos alertas estão em vigor', (tester) async {
    when(() => repo.list(filter: any(named: 'filter'), page: any(named: 'page'), limit: any(named: 'limit'))).thenAnswer((_) async => pageOf([]));
    await pump(tester);
    expect(find.text('Notícias e monitoramento'), findsOneWidget);
    expect(find.text('3 alertas em vigor nas cidades monitoradas'), findsOneWidget);
  });

  testWidgets('lista alertas com gravidade e status atuais, não lidos marcados', (tester) async {
    when(() => repo.list(filter: any(named: 'filter'), page: any(named: 'page'), limit: any(named: 'limit')))
        .thenAnswer((_) async => pageOf([alertJson('a'), alertJson('b', readAt: '2026-11-23T10:00:00.000Z')], unread: 1));
    await pump(tester);

    expect(find.text('Alagamento de gravidade crítica a 300 m (Sé)'), findsNWidgets(2));
    expect(find.text('Crítica'), findsNWidgets(2));
    expect(find.text('Pendente'), findsNWidgets(2));
    expect(find.bySemanticsLabel(RegExp(r'Não lido(?!s)')), findsOneWidget);
    expect(find.text('Não lidos (1)'), findsOneWidget);
    expect(find.text('Marcar todos como lidos'), findsOneWidget);
    // Sem área de interesse definida, o aviso orienta a configurar.
    expect(find.textContaining('Defina sua área de interesse'), findsOneWidget);
  });

  testWidgets('filtro vai para a API e cada filtro tem seu estado vazio', (tester) async {
    when(() => repo.list(filter: any(named: 'filter'), page: any(named: 'page'), limit: any(named: 'limit')))
        .thenAnswer((_) async => pageOf([]));
    await pump(tester);
    expect(find.text('Nenhum alerta por enquanto'), findsOneWidget);

    await tester.tap(find.text('Críticos'));
    await tester.pumpAndSettle();
    verify(() => repo.list(filter: NotificationFilter.critical, page: any(named: 'page'), limit: any(named: 'limit'))).called(1);
    expect(find.text('Nenhum alerta crítico'), findsOneWidget);
  });

  testWidgets('tocar marca como lido; alerta de ocorrência removida avisa em vez de abrir', (tester) async {
    when(() => repo.list(filter: any(named: 'filter'), page: any(named: 'page'), limit: any(named: 'limit')))
        .thenAnswer((_) async => pageOf([alertJson('x', occurrence: null)], unread: 1));
    when(() => repo.markRead('x')).thenAnswer((_) async {});
    await pump(tester);

    expect(find.text('Ocorrência removida'), findsOneWidget);
    await tester.tap(find.text('Alagamento de gravidade crítica a 300 m (Sé)'));
    await tester.pumpAndSettle();
    verify(() => repo.markRead('x')).called(1);
    expect(find.text('Esta ocorrência foi removida pelo autor.'), findsOneWidget);
    expect(find.bySemanticsLabel(RegExp(r'Não lido(?!s)')), findsNothing);
  });

  // Contrato mudou na Fase 7: tipo desconhecido NÃO é erro — um tipo novo no servidor
  // (ex.: NEWS_ALERT) não pode deixar a caixa de alertas inteira em erro.
  test('AppNotification: tipo desconhecido vira "outro" (não derruba a lista)', () {
    expect(AppNotification.fromJson({...alertJson('z'), 'type': 'OUTRO'}).kind, NotificationKind.other);
    expect(AppNotification.fromJson(alertJson('z', occurrence: null)).occurrence, isNull);
  });
}
