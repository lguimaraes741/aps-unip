// Teste AO VIVO da Fase 5: moderar (pela mesma chamada HTTP que o painel faz) reflete no app
// em tempo real — para quem observa e, via worker, como aviso para a autora.
// Requer `npm run api:dev` e `npm run worker:dev`. Uso:
//
//   flutter test test/live --dart-define=LIVE_TESTS=true \
//     --dart-define=API_BASE_URL=http://localhost:3000 --dart-define=DEMO_PASSWORD=<DEMO_USER_PASSWORD do .env>
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
import 'package:alertacidade/features/occurrences/occurrence_detail_page.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:uuid/uuid.dart';

const live = bool.fromEnvironment('LIVE_TESTS');
const password = String.fromEnvironment('DEMO_PASSWORD');

Future<T> waitFor<T>(T? Function() read, {Duration timeout = const Duration(seconds: 15)}) async {
  final deadline = DateTime.now().add(timeout);
  while (true) {
    final value = read();
    if (value != null) return value;
    if (DateTime.now().isAfter(deadline)) throw TimeoutException('condição não atingida');
    await Future<void>.delayed(const Duration(milliseconds: 50));
  }
}

Future<ProviderContainer> appLoggedIn(String email) async {
  final container = ProviderContainer(overrides: [tokenStorageProvider.overrideWithValue(InMemoryTokenStorage())]);
  await container.read(sessionProvider.notifier).login(email, password);
  container.listen(realtimeProvider, (_, _) {});
  await waitFor(() => container.read(realtimeProvider) == RealtimeStatus.online ? true : null);
  return container;
}

Future<ApiClient> staff(String email) async {
  final api = ApiClient(storage: InMemoryTokenStorage());
  await AuthRepository(api).login(email: email, password: password);
  return api;
}

void main() {
  test('moderação no painel → app de quem observa atualiza e a autora recebe o aviso', () async {
    final author = await appLoggedIn('cidada.a@alertacidade.demo');
    final watcher = await appLoggedIn('cidadao.b@alertacidade.demo');
    addTearDown(author.dispose);
    addTearDown(watcher.dispose);
    final moderator = await staff('moderacao@alertacidade.demo');
    final admin = await staff('admin@alertacidade.demo');

    final created = await author.read(occurrencesRepositoryProvider).create(NewOccurrence(
          clientRequestId: const Uuid().v4(),
          title: 'Teste ao vivo da moderação (Fase 5)',
          description: 'Registro temporário do teste ao vivo da moderação.',
          address: 'Praça da Sé',
          neighborhood: 'Sé',
          latitude: -23.5485,
          longitude: -46.6333,
          severity: Severity.high,
          occurredAt: DateTime.now().subtract(const Duration(minutes: 1)),
        ));
    // Limpeza: só o ADMIN remove uma ocorrência já validada (remoção auditada).
    addTearDown(() async {
      try {
        await admin.dio.delete<dynamic>('/occurrences/${created.id}');
      } catch (_) {}
    });

    // O observador abre os detalhes (como no app): status inicial PENDING.
    final sub = watcher.listen(occurrenceDetailProvider(created.id), (_, _) {});
    addTearDown(sub.close);
    final before = await watcher.read(occurrenceDetailProvider(created.id).future);
    expect(before.status, OccurrenceStatus.pending);
    final cursorBefore = watcher.read(realtimeProvider.notifier).cursor!;

    // Painel: validar (mesma rota e corpo que a tela de análise envia).
    final stopwatch = Stopwatch()..start();
    final res = await moderator.dio.post<dynamic>(
      '/admin/occurrences/${created.id}/status',
      data: {'status': 'VALIDATED', 'expectedVersion': 1, 'note': 'Confirmado no teste ao vivo'},
    );
    expect(res.data['status'], 'VALIDATED');

    // App do observador: evento chega, detalhes se recarregam sozinhos com o novo status.
    await waitFor(() => watcher.read(realtimeProvider.notifier).cursor! > cursorBefore ? true : null);
    final updated = await waitFor(() {
      final d = watcher.read(occurrenceDetailProvider(created.id)).value;
      return d?.status == OccurrenceStatus.validated ? d : null;
    });
    final watcherMs = stopwatch.elapsedMilliseconds;
    expect(updated.history.last.byModeration, isTrue);
    expect(updated.history.last.note, 'Confirmado no teste ao vivo');

    // App da autora: aviso do worker em tempo real.
    final alert = await waitFor(() {
      final a = author.read(incomingAlertProvider);
      return a?.occurrenceId == created.id ? a : null;
    });
    // ignore: avoid_print
    print('observador atualizado em $watcherMs ms; aviso para a autora em ${stopwatch.elapsedMilliseconds} ms: "${alert.title}"');
    expect(alert.title, 'Sua ocorrência #${created.code} foi validada');
    expect(alert.kind, NotificationKind.statusChanged);
  }, skip: live ? false : 'teste ao vivo: use --dart-define=LIVE_TESTS=true', timeout: const Timeout(Duration(seconds: 90)));
}
