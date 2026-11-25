import 'dart:async';

import 'package:alertacidade/core/push/push_controller.dart';
import 'package:alertacidade/core/push/push_messaging.dart';
import 'package:alertacidade/data/notifications_repository.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

class MockNotificationsRepository extends Mock implements NotificationsRepository {}

class FakePushMessaging implements PushMessaging {
  bool permission = true;
  String? id = 'fid-1';
  String? initial;
  int unregisters = 0;
  final renewals = StreamController<String>.broadcast();
  final opened = StreamController<String>.broadcast();
  final foreground = StreamController<void>.broadcast();

  @override
  Future<bool> requestPermission() async => permission;
  @override
  Future<String?> register() async => id;
  @override
  Stream<String> get onRegistered => renewals.stream;
  @override
  Future<void> unregister() async => unregisters++;
  @override
  Future<String?> initialRoute() async => initial;
  @override
  Stream<String> get openedRoutes => opened.stream;
  @override
  Stream<void> get foregroundMessages => foreground.stream;
}

void main() {
  late FakePushMessaging messaging;
  late MockNotificationsRepository repo;
  late List<String> openedIds;
  late int foregroundPushes;
  late PushController controller;

  setUp(() {
    messaging = FakePushMessaging();
    repo = MockNotificationsRepository();
    when(() => repo.registerDevice(any())).thenAnswer((_) async {});
    when(() => repo.removeDevice(any())).thenAnswer((_) async {});
    openedIds = [];
    foregroundPushes = 0;
    controller = PushController(
      messaging: messaging,
      repository: repo,
      onOpenRoute: openedIds.add,
      onForegroundPush: () => foregroundPushes++,
    );
    addTearDown(controller.dispose);
  });

  test('com permissão: registra o aparelho e informa o identificador à API', () async {
    await controller.register();
    verify(() => repo.registerDevice('fid-1')).called(1);
    expect(controller.registeredToken, 'fid-1');
  });

  test('permissão negada: nada é registrado (o app segue com tempo real e caixa de alertas)', () async {
    messaging.permission = false;
    await controller.register();
    verifyNever(() => repo.registerDevice(any()));
  });

  test('identificador renovado é reenviado uma vez, mesmo após vários logins', () async {
    await controller.register();
    await controller.unregister();
    await controller.register();
    clearInteractions(repo);
    messaging.renewals.add('fid-2');
    await pumpEventQueue();
    verify(() => repo.registerDevice('fid-2')).called(1);
  });

  test('falha de rede no registro não derruba o app', () async {
    when(() => repo.registerDevice(any())).thenThrow(Exception('sem rede'));
    await expectLater(controller.register(), completes);
    expect(controller.registeredToken, isNull);
  });

  test('logout: remove na API e desregistra o aparelho; renovações deixam de ser enviadas', () async {
    await controller.register();
    await controller.unregister();
    verify(() => repo.removeDevice('fid-1')).called(1);
    expect(messaging.unregisters, 1);
    messaging.renewals.add('fid-3');
    await pumpEventQueue();
    verifyNever(() => repo.registerDevice('fid-3'));
  });

  test('logout offline ainda desregistra o aparelho localmente', () async {
    when(() => repo.removeDevice(any())).thenThrow(Exception('sem rede'));
    await controller.register();
    await controller.unregister();
    expect(messaging.unregisters, 1);
  });

  test('toque na notificação: abre a tela (app fechado e em segundo plano); push com app aberto recarrega', () async {
    messaging.initial = '/occurrences/occ-frio';
    await controller.attach();
    messaging.opened.add('/news/fundo');
    messaging.foreground.add(null);
    await pumpEventQueue();
    expect(openedIds, ['/occurrences/occ-frio', '/news/fundo']);
    expect(foregroundPushes, 1);
    await controller.attach(); // idempotente
    messaging.opened.add('/occurrences/occ-2');
    await pumpEventQueue();
    expect(openedIds, ['/occurrences/occ-frio', '/news/fundo', '/occurrences/occ-2']);
  });

  group('pushRoute (dados enviados pelo worker)', () {
    const occ = '11111111-2222-3333-4444-555555555555';
    const news = 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee';

    test('ocorrência → detalhes da ocorrência; notícia → detalhes da notícia', () {
      expect(pushRoute({'occurrenceId': occ, 'newsEventId': '', 'type': 'NEARBY_OCCURRENCE'}), '/occurrences/$occ');
      expect(pushRoute({'occurrenceId': '', 'newsEventId': news, 'type': 'NEWS_ALERT'}), '/news/$news');
      expect(pushRoute({'occurrenceId': '', 'newsEventId': news, 'type': 'NEWS_ALERT_UPDATE'}), '/news/$news');
    });

    test('revisão urgente (só moderação) abre a central, não a notícia ainda não publicada', () {
      expect(pushRoute({'occurrenceId': '', 'newsEventId': news, 'type': 'NEWS_REVIEW_URGENT'}), '/alerts');
    });

    test('sem id, id vazio ou valor que não é UUID (não monta rota com texto arbitrário) → nada', () {
      expect(pushRoute({}), isNull);
      expect(pushRoute({'occurrenceId': '', 'newsEventId': ''}), isNull);
      expect(pushRoute({'newsEventId': '../profile/delete'}), isNull);
      expect(pushRoute({'occurrenceId': 42}), isNull);
    });
  });
}
