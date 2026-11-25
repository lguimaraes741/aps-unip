import 'dart:async';

import 'package:alertacidade/app/realtime.dart';
import 'package:alertacidade/core/providers.dart';
import 'package:alertacidade/core/realtime/realtime_sync.dart';
import 'package:alertacidade/core/realtime/socket_transport.dart';
import 'package:alertacidade/core/storage/token_storage.dart';
import 'package:alertacidade/data/auth_repository.dart';
import 'package:alertacidade/data/notifications_repository.dart';
import 'package:alertacidade/domain/models.dart';
import 'package:alertacidade/features/alerts/alerts_state.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:mocktail/mocktail.dart';

DomainEvent ev(int seq, [String occurrence = 'o1']) =>
    DomainEvent(eventId: 'e$seq', sequence: BigInt.from(seq), type: 'occurrence.updated', occurrenceId: occurrence);

SyncResult result(int cursor, {List<int> events = const [], bool hasMore = false, bool reset = false}) =>
    SyncResult(events: events.map(ev).toList(), cursor: BigInt.from(cursor), hasMore: hasMore, reset: reset);

/// Servidor falso: responde /sync a partir de uma lista de eventos publicados.
class FakeServer {
  FakeServer(this.published, {this.pageSize = 100});

  final List<int> published;
  final int pageSize;
  final calls = <int?>[];

  Future<SyncResult> fetch(BigInt? since) async {
    calls.add(since?.toInt());
    final head = published.isEmpty ? 0 : published.last;
    if (since == null) return result(head);
    if (since > BigInt.from(head)) return result(head, reset: true);
    final after = published.where((s) => s > since.toInt()).toList();
    final page = after.take(pageSize).toList();
    return result(page.isEmpty ? since.toInt() : page.last, events: page, hasMore: after.length > page.length);
  }
}

void main() {
  group('RealtimeSync (cursor de entrega)', () {
    late List<int> applied;
    late int reloads;

    RealtimeSync build(FakeServer server) => RealtimeSync(
          fetch: server.fetch,
          onEvent: (e) => applied.add(e.sequence.toInt()),
          onReload: () => reloads++,
        );

    setUp(() {
      applied = [];
      reloads = 0;
    });

    test('sem cursor: pega o atual e recarrega tudo (estado persistido é a fonte da verdade)', () async {
      final sync = build(FakeServer([1, 2, 3]));
      await sync.resync();
      expect(sync.cursor, BigInt.from(3));
      expect(reloads, 1);
      expect(applied, isEmpty);
    });

    test('aplica em ordem e descarta duplicatas (entrega "pelo menos uma vez")', () async {
      final server = FakeServer([1, 2, 3]);
      final sync = build(server);
      await sync.resync();
      await sync.receive(ev(4));
      await sync.receive(ev(4));
      await sync.receive(ev(3));
      await sync.receive(ev(5));
      expect(applied, [4, 5]);
      expect(sync.cursor, BigInt.from(5));
      expect(server.calls, [null]); // nenhuma ressincronização necessária
    });

    test('lacuna no cursor dispara /sync e recupera os eventos perdidos na ordem', () async {
      final server = FakeServer([1, 2]);
      final sync = build(server);
      await sync.resync();
      server.published.addAll([3, 4, 5]);
      await sync.receive(ev(5)); // 3 e 4 se perderam
      expect(applied, [3, 4, 5]);
      expect(server.calls.last, 2);
      await sync.receive(ev(5)); // a entrega atrasada do 5 é ignorada
      expect(applied, [3, 4, 5]);
    });

    test('número pulado (publicação desfeita) não trava: o /sync avança o cursor', () async {
      final server = FakeServer([1, 2]);
      final sync = build(server);
      await sync.resync();
      server.published.add(4); // o 3 nunca existiu
      await sync.receive(ev(4));
      expect(applied, [4]);
      await sync.receive(ev(5));
      expect(applied, [4, 5]);
    });

    test('reconexão percorre várias páginas do /sync', () async {
      final server = FakeServer([1], pageSize: 2);
      final sync = build(server);
      await sync.resync();
      server.published.addAll([2, 3, 4, 5, 6]);
      await sync.resync();
      expect(applied, [2, 3, 4, 5, 6]);
      expect(server.calls, [null, 1, 3, 5]);
    });

    test('reset (banco recriado no servidor) recarrega tudo e adota o cursor do servidor', () async {
      final server = FakeServer([1, 2, 3, 4, 5, 6, 7, 8, 9]);
      final sync = build(server);
      await sync.resync();
      server.published
        ..clear()
        ..addAll([1, 2]);
      await sync.resync();
      expect(reloads, 2);
      expect(sync.cursor, BigInt.from(2));
    });

    test('ressincronizações simultâneas são unidas (sem buscar a mesma coisa em paralelo)', () async {
      final gate = Completer<void>();
      final calls = <int?>[];
      final sync = RealtimeSync(
        fetch: (since) async {
          calls.add(since?.toInt());
          if (calls.length == 1) await gate.future;
          return result(3);
        },
        onEvent: (_) {},
        onReload: () => reloads++,
      );
      final a = sync.resync();
      final b = sync.resync();
      final c = sync.resync();
      gate.complete();
      await Future.wait([a, b, c]);
      expect(calls, [null, 3]); // uma em andamento + uma rodada extra no final
    });

    test('erro de rede no /sync não perde o cursor', () async {
      var fail = false;
      final sync = RealtimeSync(
        fetch: (since) async {
          if (fail) throw Exception('sem rede');
          return result(7);
        },
        onEvent: (_) {},
        onReload: () {},
      );
      await sync.resync();
      fail = true;
      await expectLater(sync.resync(), throwsException);
      expect(sync.cursor, BigInt.from(7));
    });
  });

  group('DomainEvent e SyncResult', () {
    test('sequence grande (bigint do PostgreSQL) e tipo desconhecido não quebram', () {
      final e = DomainEvent.fromJson({
        'eventId': 'x',
        'sequence': '9007199254740993', // > 2^53: perderia precisão como double
        'type': 'occurrence.algo_novo',
        'occurredAt': '2026-11-23T12:00:00.000Z',
        'payload': {'occurrenceId': 'o9'},
      });
      expect(e.sequence, BigInt.parse('9007199254740993'));
      expect(e.type, 'occurrence.algo_novo');
      final s = SyncResult.fromJson({'events': [], 'cursor': '12', 'hasMore': false});
      expect(s.reset, isFalse);
    });
  });

  group('RealtimeController', () {
    late FakeTransport transport;
    late MockNotificationsRepository repository;
    late InMemoryTokenStorage storage;
    late ProviderContainer container;
    var head = 10;

    setUp(() {
      transport = FakeTransport();
      repository = MockNotificationsRepository();
      storage = InMemoryTokenStorage();
      head = 10;
      when(() => repository.sync(since: any(named: 'since'))).thenAnswer((inv) async {
        final since = inv.namedArguments[#since] as BigInt?;
        return since == null ? result(head) : result(head, events: [for (var s = since.toInt() + 1; s <= head; s++) s]);
      });
      when(() => repository.list(limit: any(named: 'limit'))).thenAnswer(
        (_) async => const NotificationsPage(page: Paged(items: [], total: 0, page: 1, limit: 1), unread: 0),
      );
      final auth = MockAuthRepository();
      when(() => auth.restore()).thenAnswer((_) async => const UserProfile(id: 'u1', name: 'Ana', email: 'a@a.com', role: UserRole.citizen));
      container = ProviderContainer(overrides: [
        realtimeTransportProvider.overrideWithValue(transport),
        notificationsRepositoryProvider.overrideWithValue(repository),
        tokenStorageProvider.overrideWithValue(storage),
        authRepositoryProvider.overrideWithValue(auth),
      ]);
      addTearDown(container.dispose);
    });

    Future<void> startLoggedIn() async {
      container.read(realtimeProvider);
      await container.read(sessionProvider.future);
      await pumpEventQueue();
    }

    test('com sessão: busca o cursor e só então conecta, usando o token mais recente', () async {
      await storage.save(accessToken: 'token-1', refreshToken: 'r');
      await startLoggedIn();
      verify(() => repository.sync(since: null)).called(1);
      expect(transport.connects, 1);
      expect(transport.token!(), 'token-1');
      await storage.save(accessToken: 'token-2', refreshToken: 'r');
      expect(transport.token!(), 'token-2'); // reconexões automáticas usam o token renovado
      expect(container.read(realtimeProvider.notifier).cursor, BigInt.from(10));
    });

    test('conectado → online e ressincroniza; evento com lacuna busca o que faltou', () async {
      await startLoggedIn();
      transport.emit(const SocketConnected());
      await pumpEventQueue();
      expect(container.read(realtimeProvider), RealtimeStatus.online);

      head = 13;
      transport.emit(SocketEvent({'eventId': 'e13', 'sequence': '13', 'type': 'occurrence.created', 'payload': {'occurrenceId': 'o1'}}));
      await pumpEventQueue();
      verify(() => repository.sync(since: BigInt.from(10))).called(greaterThanOrEqualTo(1));
      expect(container.read(realtimeProvider.notifier).cursor, BigInt.from(13));
    });

    test('conexão recusada por token: renova pelo /sync (fila do ApiClient) e reconecta', () async {
      await startLoggedIn();
      clearInteractions(repository);
      transport.emit(const SocketConnectError(unauthorized: true));
      await Future<void>.delayed(const Duration(milliseconds: 1100)); // backoff inicial de 1 s
      await pumpEventQueue();
      verify(() => repository.sync(since: any(named: 'since'))).called(1);
      expect(transport.reconnects, 1);
    });

    test('alerta em tempo real vira aviso no app', () async {
      await startLoggedIn();
      transport.emit(const SocketNotification({
        'id': 'n1',
        'type': 'OCCURRENCE_NEARBY',
        'occurrenceId': 'o1',
        'title': 'Alagamento de gravidade alta a 300 m',
        'body': 'Relato de cidadão',
        'distanceMeters': 300,
        'occurrence': {'code': 7, 'severity': 'HIGH', 'status': 'PENDING'},
        'readAt': null,
        'createdAt': '2026-11-23T12:00:00.000Z',
      }));
      await pumpEventQueue();
      expect(container.read(incomingAlertProvider)?.title, 'Alagamento de gravidade alta a 300 m');
    });

    test('logout desconecta e esquece o cursor', () async {
      await startLoggedIn();
      when(() => container.read(authRepositoryProvider).logout()).thenAnswer((_) async {});
      await container.read(sessionProvider.notifier).logout();
      await pumpEventQueue();
      expect(transport.disconnects, 1);
      expect(container.read(realtimeProvider), RealtimeStatus.offline);
      expect(container.read(realtimeProvider.notifier).cursor, isNull);
    });
  });
}

class MockNotificationsRepository extends Mock implements NotificationsRepository {}

class MockAuthRepository extends Mock implements AuthRepository {}

class FakeTransport implements RealtimeTransport {
  final _controller = StreamController<RealtimeSignal>.broadcast();
  String? Function()? token;
  int connects = 0;
  int reconnects = 0;
  int disconnects = 0;

  void emit(RealtimeSignal signal) => _controller.add(signal);

  @override
  Stream<RealtimeSignal> get signals => _controller.stream;

  @override
  void connect(String? Function() token) {
    this.token = token;
    connects++;
  }

  @override
  void reconnect() => reconnects++;

  @override
  void disconnect() => disconnects++;

  @override
  void dispose() => _controller.close();
}
