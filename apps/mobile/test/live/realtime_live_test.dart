// Teste AO VIVO: o código real do app (ApiClient, repositórios, RealtimeController e
// SocketIoTransport com socket_io_client) contra a API e o worker rodando localmente.
// Não roda no `flutter test` comum. Uso (na raiz, com `npm run api:dev` e `npm run worker:dev`):
//
//   flutter test test/live --dart-define=LIVE_TESTS=true \
//     --dart-define=API_BASE_URL=http://localhost:3000 --dart-define=DEMO_PASSWORD=<DEMO_USER_PASSWORD do .env>
//
// Usa as contas de demonstração e desfaz o que criou (ocorrência removida, preferências restauradas).
@Tags(['live'])
library;

import 'dart:async';

import 'package:alertacidade/app/realtime.dart';
import 'package:alertacidade/core/network/api_client.dart';
import 'package:alertacidade/core/providers.dart';
import 'package:alertacidade/core/storage/token_storage.dart';
import 'package:alertacidade/data/auth_repository.dart';
import 'package:alertacidade/data/occurrences_repository.dart';
import 'package:alertacidade/domain/models.dart';
import 'package:alertacidade/features/alerts/alerts_state.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:uuid/uuid.dart';

const live = bool.fromEnvironment('LIVE_TESTS');
const password = String.fromEnvironment('DEMO_PASSWORD');
const se = (lat: -23.55052, lng: -46.63331);

Future<T> waitFor<T>(T? Function() read, {Duration timeout = const Duration(seconds: 10)}) async {
  final deadline = DateTime.now().add(timeout);
  while (true) {
    final value = read();
    if (value != null) return value;
    if (DateTime.now().isAfter(deadline)) throw TimeoutException('condição não atingida');
    await Future<void>.delayed(const Duration(milliseconds: 50));
  }
}

void main() {
  test('app real ↔ API real: evento e alerta chegam pelo Socket.IO; reconexão recupera pelo /sync', () async {
    // B: o "aparelho" que observa, montado como o app monta (providers reais, storage em memória).
    final storageB = InMemoryTokenStorage();
    final b = ProviderContainer(overrides: [tokenStorageProvider.overrideWithValue(storageB)]);
    addTearDown(b.dispose);
    // A: quem registra (outro cliente da API).
    final apiA = ApiClient(storage: InMemoryTokenStorage());
    await AuthRepository(apiA).login(email: 'cidada.a@alertacidade.demo', password: password);
    final occurrencesA = OccurrencesRepository(apiA);

    await b.read(sessionProvider.notifier).login('cidadao.b@alertacidade.demo', password);
    final users = b.read(usersRepositoryProvider);
    final originalPrefs = await users.preferences();
    await users.savePreferences(NotificationPreferences(
      pushEnabled: true, radiusMeters: 3000, minSeverity: Severity.moderate, latitude: se.lat, longitude: se.lng,
    ));
    String? createdId;
    final created = <String>[];
    addTearDown(() async {
      for (final id in created) {
        await occurrencesA.remove(id).catchError((_) {});
      }
      await users.savePreferences(originalPrefs).catchError((_) => originalPrefs);
    });

    // 1) Conecta de verdade (handshake com JWT, transporte WebSocket).
    b.listen(realtimeProvider, (_, _) {});
    await waitFor(() => b.read(realtimeProvider) == RealtimeStatus.online ? true : null);
    final controller = b.read(realtimeProvider.notifier);
    final start = controller.cursor!;

    // 2) A registra → B recebe o evento (cursor avança) e o alerta do worker.
    final stopwatch = Stopwatch()..start();
    final first = await occurrencesA.create(NewOccurrence(
      clientRequestId: const Uuid().v4(), title: 'Teste ao vivo do app (Fase 4)', description: 'Registro temporário do teste ao vivo.',
      address: 'Praça da Sé', neighborhood: 'Sé', latitude: se.lat + 0.002, longitude: se.lng,
      severity: Severity.critical, occurredAt: DateTime.now().subtract(const Duration(minutes: 1)),
    ));
    created.add(createdId = first.id);
    await waitFor(() => controller.cursor! > start ? true : null);
    final eventMs = stopwatch.elapsedMilliseconds;
    final alert = await waitFor(() {
      final a = b.read(incomingAlertProvider);
      return a?.occurrenceId == createdId ? a : null;
    });
    // ignore: avoid_print
    print('evento em $eventMs ms; alerta em ${stopwatch.elapsedMilliseconds} ms: "${alert.title}"');
    expect(alert.occurrence?.severity, Severity.critical);

    // 3) Queda: B desconecta, A registra de novo; ao reconectar, B recupera pelo /sync.
    final transport = b.read(realtimeTransportProvider);
    transport.disconnect();
    await waitFor(() => b.read(realtimeProvider) != RealtimeStatus.online ? true : null);
    final beforeOffline = controller.cursor!;
    final second = await occurrencesA.create(NewOccurrence(
      clientRequestId: const Uuid().v4(), title: 'Teste ao vivo do app (offline)', description: 'Registro temporário do teste ao vivo.',
      address: 'Praça da Sé', neighborhood: 'Sé', latitude: se.lat + 0.002, longitude: se.lng,
      severity: Severity.high, occurredAt: DateTime.now().subtract(const Duration(minutes: 1)),
    ));
    created.add(second.id);
    await Future<void>.delayed(const Duration(seconds: 2)); // publicado enquanto B está fora
    expect(controller.cursor, beforeOffline); // nada chegou pelo socket
    transport.reconnect();
    await waitFor(() => controller.cursor! > beforeOffline ? true : null);
    expect(b.read(realtimeProvider), RealtimeStatus.online);

    // 4) A caixa de alertas real tem os dois.
    final inbox = await b.read(notificationsRepositoryProvider).list(limit: 5);
    expect(inbox.page.items.map((n) => n.occurrenceId), containsAll([first.id, second.id]));
  }, skip: live ? false : 'teste ao vivo: use --dart-define=LIVE_TESTS=true', timeout: const Timeout(Duration(seconds: 60)));
}
