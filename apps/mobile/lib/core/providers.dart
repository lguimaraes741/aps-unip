import 'dart:async';

import 'package:connectivity_plus/connectivity_plus.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../data/auth_repository.dart';
import '../data/news_repository.dart';
import '../data/notifications_repository.dart';
import '../data/occurrences_repository.dart';
import '../data/users_repository.dart';
import '../domain/models.dart';
import 'location/location_service.dart';
import 'network/api_client.dart';
import 'push/push_controller.dart';
import 'realtime/socket_transport.dart';
import 'storage/token_storage.dart';

// ---------------------------------------------------------------------------
// Infraestrutura (substituível nos testes com overrides)
// ---------------------------------------------------------------------------

final tokenStorageProvider = Provider<TokenStorage>((ref) => SecureTokenStorage());

final apiClientProvider = Provider<ApiClient>((ref) => ApiClient(storage: ref.watch(tokenStorageProvider)));

final authRepositoryProvider = Provider<AuthRepository>((ref) => AuthRepository(ref.watch(apiClientProvider)));

final occurrencesRepositoryProvider =
    Provider<OccurrencesRepository>((ref) => OccurrencesRepository(ref.watch(apiClientProvider)));

final newsRepositoryProvider = Provider<NewsRepository>((ref) => NewsRepository(ref.watch(apiClientProvider)));

final usersRepositoryProvider = Provider<UsersRepository>((ref) => UsersRepository(ref.watch(apiClientProvider)));

final locationServiceProvider = Provider<LocationService>((ref) => GeolocatorLocationService());

final notificationsRepositoryProvider =
    Provider<NotificationsRepository>((ref) => NotificationsRepository(ref.watch(apiClientProvider)));

/// Push: registra o token do aparelho e trata o toque nas notificações (Fase 4).
final pushControllerProvider = Provider<PushController>((ref) {
  final controller = PushController(
    messaging: ref.watch(pushMessagingProvider),
    repository: ref.watch(notificationsRepositoryProvider),
    onOpenRoute: (route) => ref.read(pushOpenProvider.notifier).open(route),
    onForegroundPush: () => ref.read(pushTickProvider.notifier).tick(),
  );
  ref.onDispose(controller.dispose);
  return controller;
});

/// Canal Socket.IO com a API (Fase 4).
final realtimeTransportProvider = Provider<RealtimeTransport>((ref) {
  final transport = SocketIoTransport();
  ref.onDispose(transport.dispose);
  return transport;
});

// ---------------------------------------------------------------------------
// Sessão
// ---------------------------------------------------------------------------

/// Usuário autenticado (`null` = sem sessão). O estado de carregamento inicial
/// corresponde à restauração da sessão salva (tela de splash).
class SessionController extends AsyncNotifier<UserProfile?> {
  @override
  Future<UserProfile?> build() async {
    // Se a renovação automática do token falhar em qualquer requisição, a sessão termina.
    ref.read(apiClientProvider).onSessionExpired = () => state = const AsyncData(null);
    final push = ref.read(pushControllerProvider);
    unawaited(push.attach().catchError((_) {}));
    final user = await ref.read(authRepositoryProvider).restore();
    if (user != null) unawaited(push.register());
    return user;
  }

  Future<void> login(String email, String password) async {
    final user = await ref.read(authRepositoryProvider).login(email: email, password: password);
    state = AsyncData(user);
    unawaited(ref.read(pushControllerProvider).register());
  }

  Future<void> register(String name, String email, String password) async {
    final user = await ref.read(authRepositoryProvider).register(name: name, email: email, password: password);
    state = AsyncData(user);
    unawaited(ref.read(pushControllerProvider).register());
  }

  Future<void> logout() async {
    // Antes de encerrar: a remoção do token na API exige a sessão ainda válida.
    await ref.read(pushControllerProvider).unregister();
    await ref.read(authRepositoryProvider).logout();
    state = const AsyncData(null);
  }

  void updateUser(UserProfile user) => state = AsyncData(user);
}

final sessionProvider = AsyncNotifierProvider<SessionController, UserProfile?>(SessionController.new);

// ---------------------------------------------------------------------------
// Conectividade
// ---------------------------------------------------------------------------

/// `true` quando há alguma interface de rede ativa. Usado no banner "sem conexão" e
/// para recarregar os dados persistidos quando a conexão volta.
final connectivityProvider = StreamProvider<bool>((ref) async* {
  final connectivity = Connectivity();
  bool online(List<ConnectivityResult> r) => r.any((c) => c != ConnectivityResult.none);
  yield online(await connectivity.checkConnectivity());
  yield* connectivity.onConnectivityChanged.map(online);
});
