import 'dart:async';

import 'package:firebase_messaging/firebase_messaging.dart';

/// Tela a abrir pelo toque numa notificação. O worker envia `occurrenceId`, `newsEventId`
/// (vazio quando não se aplica) e `type`; alerta de notícia → detalhes da notícia; revisão de
/// moderação → central de Alertas. Sem nenhum dos dois
/// (ou id inválido) → nenhuma tela específica.
String? pushRoute(Map<String, dynamic> data) {
  final uuid = RegExp(r'^[0-9a-fA-F-]{36}$');
  String? id(String key) {
    final v = data[key];
    return v is String && uuid.hasMatch(v) ? v : null;
  }

  // Revisão de moderação: a notícia pode não estar publicada → abre a central de Alertas.
  if (data['type'] == 'NEWS_REVIEW_URGENT') return '/alerts';
  final news = id('newsEventId');
  if (news != null) return '/news/$news';
  final occurrence = id('occurrenceId');
  return occurrence == null ? null : '/occurrences/$occurrence';
}

/// Recursos de push usados pelo app (substituível nos testes e sem Firebase).
abstract class PushMessaging {
  /// Android 13+ pede a permissão ao usuário; versões anteriores concedem automaticamente.
  Future<bool> requestPermission();

  /// Registra este aparelho no FCM e devolve o identificador de envio (Firebase Installation ID).
  Future<String?> register();

  /// Novo identificador (ex.: reinstalação/renovação): precisa ser informado à API de novo.
  Stream<String> get onRegistered;

  /// Desregistra este aparelho (logout): a conta anterior para de receber aqui.
  Future<void> unregister();

  /// Tela (rota do app) da notificação que ABRIU o app a partir do estado fechado.
  Future<String?> initialRoute();

  /// Tela da notificação tocada com o app em segundo plano.
  Stream<String> get openedRoutes;

  /// Push recebido com o app aberto (o Android não exibe nada nesse caso).
  Stream<void> get foregroundMessages;
}

/// App sem Firebase configurado (ex.: build sem google-services.json): push desativado.
class DisabledPushMessaging implements PushMessaging {
  const DisabledPushMessaging();

  @override
  Future<bool> requestPermission() async => false;
  @override
  Future<String?> register() async => null;
  @override
  Stream<String> get onRegistered => const Stream.empty();
  @override
  Future<void> unregister() async {}
  @override
  Future<String?> initialRoute() async => null;
  @override
  Stream<String> get openedRoutes => const Stream.empty();
  @override
  Stream<void> get foregroundMessages => const Stream.empty();
}

class FirebasePushMessaging implements PushMessaging {
  FirebasePushMessaging([FirebaseMessaging? messaging]) : _messaging = messaging ?? FirebaseMessaging.instance;

  final FirebaseMessaging _messaging;


  @override
  Future<bool> requestPermission() async {
    final settings = await _messaging.requestPermission();
    return settings.authorizationStatus == AuthorizationStatus.authorized ||
        settings.authorizationStatus == AuthorizationStatus.provisional;
  }

  /// firebase_messaging 17: o envio é por Firebase Installation ID (FID), entregue em
  /// [FirebaseMessaging.onRegistered] depois de [FirebaseMessaging.register] (o antigo
  /// getToken está obsoleto, assim como o envio por `token` no firebase-admin do worker).
  @override
  Future<String?> register() async {
    final id = _messaging.onRegistered.first.timeout(const Duration(seconds: 30));
    await _messaging.register();
    return id;
  }

  @override
  Stream<String> get onRegistered => _messaging.onRegistered;

  @override
  Future<void> unregister() => _messaging.unregister();

  @override
  Future<String?> initialRoute() async {
    final message = await _messaging.getInitialMessage();
    return message == null ? null : pushRoute(message.data);
  }

  @override
  Stream<String> get openedRoutes =>
      FirebaseMessaging.onMessageOpenedApp.map((m) => pushRoute(m.data)).where((r) => r != null).cast<String>();

  @override
  Stream<void> get foregroundMessages => FirebaseMessaging.onMessage.map((_) {});
}
