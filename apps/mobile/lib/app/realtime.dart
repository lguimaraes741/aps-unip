import 'dart:async';
import 'dart:math';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/providers.dart';
import '../core/realtime/realtime_sync.dart';
import '../core/realtime/socket_transport.dart';
import '../domain/models.dart';
import '../features/alerts/alerts_state.dart';
import '../features/map/map_state.dart';
import '../features/news/news_feed_state.dart';
import '../features/news/news_state.dart';
import '../features/occurrences/my_reports_page.dart';
import '../features/occurrences/occurrence_detail_page.dart';

enum RealtimeStatus { offline, connecting, online }

/// Liga o app ao canal de tempo real enquanto há sessão.
///
/// - Antes de conectar, busca o cursor por `GET /sync` (que também garante um token de
///   acesso válido, renovado pela fila única do [ApiClient]).
/// - Eventos de ocorrência recarregam, de forma agrupada, o mapa, "Meus registros" e os
///   detalhes abertos — a API continua sendo a fonte da verdade.
/// - Conexão recusada por token expirado: renova pelo mesmo caminho e reconecta, com backoff.
class RealtimeController extends Notifier<RealtimeStatus> {
  static const debounce = Duration(milliseconds: 300);

  RealtimeTransport? _transport;
  StreamSubscription<RealtimeSignal>? _subscription;
  RealtimeSync? _sync;
  Timer? _flushTimer;
  Timer? _authTimer;
  final _changed = <String>{};
  final _changedNews = <String>{};
  bool _reloadAll = false;
  bool _newsChanged = false;
  int _authFailures = 0;

  @override
  RealtimeStatus build() {
    ref.onDispose(() => _stop(updateState: false));
    ref.listen<AsyncValue<UserProfile?>>(sessionProvider, (_, next) {
      // Fora do build: o estado do notifier não pode mudar enquanto ele é construído.
      if (next.value != null) {
        scheduleMicrotask(_start);
      } else if (!next.isLoading) {
        scheduleMicrotask(_stop);
      }
    }, fireImmediately: true);
    return RealtimeStatus.offline;
  }

  BigInt? get cursor => _sync?.cursor;

  Future<void> _start() async {
    if (_transport != null) return;
    final transport = ref.read(realtimeTransportProvider);
    _transport = transport;
    final repository = ref.read(notificationsRepositoryProvider);
    _sync = RealtimeSync(fetch: (since) => repository.sync(since: since), onEvent: _onEvent, onReload: _onReload);
    _subscription = transport.signals.listen(_onSignal);
    state = RealtimeStatus.connecting;
    try {
      await _sync!.resync();
    } catch (_) {
      // Sem rede agora: a conexão abaixo tenta de novo sozinha e ressincroniza ao conectar.
    }
    if (_transport == null) return; // sessão encerrada enquanto aguardava
    final storage = ref.read(tokenStorageProvider);
    transport.connect(() => storage.accessToken);
  }

  void _stop({bool updateState = true}) {
    _subscription?.cancel();
    _subscription = null;
    _transport?.disconnect();
    _transport = null;
    _sync?.clear();
    _sync = null;
    _flushTimer?.cancel();
    _authTimer?.cancel();
    _changed.clear();
    _changedNews.clear();
    _newsChanged = false;
    _authFailures = 0;
    if (updateState) state = RealtimeStatus.offline;
  }

  void _onSignal(RealtimeSignal signal) {
    switch (signal) {
      case SocketConnected():
        _authFailures = 0;
        state = RealtimeStatus.online;
        unawaited(_sync?.resync().catchError((_) {}));
      case SocketDisconnected(:final byServer):
        state = RealtimeStatus.connecting;
        // Encerrada pelo servidor (token expirou): o cliente não reconecta sozinho.
        if (byServer) _recoverAuth();
      case SocketConnectError(:final unauthorized):
        state = RealtimeStatus.connecting;
        if (unauthorized) _recoverAuth();
      case SocketEvent(:final json):
        try {
          unawaited(_sync?.receive(DomainEvent.fromJson(json)).catchError((_) {}));
        } on Object {
          _sync?.resync().catchError((_) {}); // evento malformado: confia no /sync
        }
      case SocketNotification(:final json):
        ref.invalidate(alertsProvider);
        ref.invalidate(unreadAlertsProvider);
        try {
          ref.read(incomingAlertProvider.notifier).push(AppNotification.fromJson(json));
        } on Object {
          // aviso visual é opcional; a lista já foi recarregada
        }
    }
  }

  /// Renova o token pelo ApiClient (GET /sync) e reconecta, com backoff de 1 s a 30 s.
  /// Se a sessão tiver expirado de vez, o ApiClient encerra a sessão e [_stop] é chamado.
  void _recoverAuth() {
    if (_authTimer?.isActive ?? false) return;
    final delay = Duration(seconds: min(30, 1 << min(_authFailures, 5)));
    _authFailures++;
    _authTimer = Timer(delay, () async {
      try {
        await _sync?.resync();
      } catch (_) {
        // falhou de novo: a próxima recusa agenda outra tentativa
      }
      _transport?.reconnect();
    });
  }

  void _onEvent(DomainEvent event) {
    if (event.isNews) {
      // news.alert.* (publicado, atualizado, encerrado, retirado, expirado): recarrega a camada do
      // mapa e o detalhe aberto — alerta retirado some do mapa porque a API deixa de listá-lo.
      _newsChanged = true;
      if (event.newsEventId != null) _changedNews.add(event.newsEventId!);
      _scheduleFlush();
      return;
    }
    final id = event.occurrenceId;
    if (id == null) return; // tipo desconhecido de versão futura: ignorado
    _changed.add(id);
    _scheduleFlush();
  }

  void _onReload() {
    _reloadAll = true;
    _scheduleFlush();
  }

  /// Agrupa rajadas de eventos (ex.: várias confirmações seguidas) em um único recarregamento.
  void _scheduleFlush() {
    _flushTimer?.cancel();
    _flushTimer = Timer(debounce, () {
      if (_changed.isNotEmpty || _reloadAll) {
        ref.invalidate(nearbyOccurrencesProvider);
        ref.invalidate(myReportsProvider);
        ref.invalidate(mySummaryProvider);
      }
      for (final id in _changed) {
        ref.invalidate(occurrenceDetailProvider(id));
      }
      if (_newsChanged || _reloadAll) {
        ref.invalidate(nearbyNewsProvider);
        ref.invalidate(newsFeedProvider);
        ref.invalidate(activeNewsCountProvider);
      }
      for (final id in _changedNews) {
        ref.invalidate(newsDetailProvider(id));
      }
      if (_reloadAll) {
        ref.invalidate(alertsProvider);
        ref.invalidate(unreadAlertsProvider);
      }
      _changed.clear();
      _changedNews.clear();
      _newsChanged = false;
      _reloadAll = false;
    });
  }
}

final realtimeProvider = NotifierProvider<RealtimeController, RealtimeStatus>(RealtimeController.new);
