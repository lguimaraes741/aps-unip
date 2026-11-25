import 'dart:async';

import 'package:flutter/foundation.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../data/notifications_repository.dart';
import 'push_messaging.dart';

/// Ciclo de vida do push no aparelho:
///  - com sessão: pede a permissão (Android 13+), registra o aparelho no FCM e informa o
///    identificador à API (`PUT /devices`), acompanhando as renovações;
///  - logout: remove o token na API ANTES de encerrar a sessão (a rota exige autenticação)
///    e invalida o token local — a conta anterior deixa de receber neste aparelho;
///  - toque na notificação (app fechado ou em segundo plano): publica a tela a abrir.
class PushController {
  PushController({required this.messaging, required this.repository, required this.onOpenRoute, required this.onForegroundPush});

  final PushMessaging messaging;
  final NotificationsRepository repository;
  final void Function(String route) onOpenRoute;
  final void Function() onForegroundPush;

  final _subscriptions = <StreamSubscription<Object?>>[];
  StreamSubscription<String>? _renewals;
  String? _registeredToken;
  bool _listening = false;

  String? get registeredToken => _registeredToken;

  /// Chamado ao iniciar o app (com ou sem sessão): trata o toque que abriu o app.
  Future<void> attach() async {
    if (_listening) return;
    _listening = true;
    _subscriptions
      ..add(messaging.openedRoutes.listen(onOpenRoute))
      ..add(messaging.foregroundMessages.listen((_) => onForegroundPush()));
    final initial = await messaging.initialRoute();
    if (initial != null) onOpenRoute(initial);
  }

  /// Sessão iniciada: permissão + registro do aparelho. Falhas não impedem o uso do app.
  Future<void> register() async {
    try {
      if (!await messaging.requestPermission()) {
        debugPrint('[push] permissão de notificações negada');
        return;
      }
      final id = await messaging.register();
      debugPrint('[push] identificador do aparelho: ${id == null ? 'nenhum' : 'recebido'}');
      if (id != null) await _send(id);
      debugPrint('[push] aparelho cadastrado na API');
      // Renovações posteriores do identificador (uma única assinatura, mesmo após vários logins).
      await _renewals?.cancel();
      _renewals = messaging.onRegistered.listen((renewed) {
        if (renewed != _registeredToken) unawaited(_send(renewed).catchError((_) {}));
      });
    } catch (error) {
      // Sem rede ou sem Google Play Services: o app segue com o tempo real e a caixa de alertas.
      debugPrint('[push] cadastro do aparelho falhou: $error');
    }
  }

  Future<void> _send(String token) async {
    await repository.registerDevice(token);
    _registeredToken = token;
  }

  /// Antes do logout: desvincula o aparelho da conta.
  Future<void> unregister() async {
    await _renewals?.cancel();
    _renewals = null;
    final token = _registeredToken;
    _registeredToken = null;
    try {
      if (token != null) await repository.removeDevice(token);
    } catch (_) {
      // offline: o token é invalidado abaixo, e o worker apaga tokens mortos ao tentar enviar
    }
    try {
      await messaging.unregister();
    } catch (_) {}
  }

  void dispose() {
    for (final s in _subscriptions) {
      s.cancel();
    }
    _subscriptions.clear();
    _renewals?.cancel();
    _renewals = null;
    _listening = false;
  }
}

/// Implementação do push (Firebase quando configurado; ver main.dart).
final pushMessagingProvider = Provider<PushMessaging>((ref) => const DisabledPushMessaging());

/// Tela a abrir por causa de um toque em notificação (consumida pelo shell).
class PushOpenNotifier extends Notifier<String?> {
  @override
  String? build() => null;

  void open(String route) => state = route;
  void consumed() => state = null;
}

final pushOpenProvider = NotifierProvider<PushOpenNotifier, String?>(PushOpenNotifier.new);

/// Incrementa a cada push recebido com o app aberto: listas de alertas se recarregam.
class PushTickNotifier extends Notifier<int> {
  @override
  int build() => 0;

  void tick() => state++;
}

final pushTickProvider = NotifierProvider<PushTickNotifier, int>(PushTickNotifier.new);
