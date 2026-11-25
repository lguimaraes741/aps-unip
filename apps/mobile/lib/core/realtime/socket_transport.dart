import 'dart:async';

import 'package:socket_io_client/socket_io_client.dart' as io;

import '../config/app_config.dart';

/// O que o canal de tempo real informa ao app.
sealed class RealtimeSignal {
  const RealtimeSignal();
}

class SocketConnected extends RealtimeSignal {
  const SocketConnected();
}

/// [byServer] = o servidor encerrou (ex.: token expirou); o cliente não reconecta sozinho.
class SocketDisconnected extends RealtimeSignal {
  const SocketDisconnected({required this.byServer});
  final bool byServer;
}

/// Conexão recusada. [unauthorized] = token ausente/expirado/inválido.
class SocketConnectError extends RealtimeSignal {
  const SocketConnectError({required this.unauthorized});
  final bool unauthorized;
}

class SocketEvent extends RealtimeSignal {
  const SocketEvent(this.json);
  final Map<String, dynamic> json;
}

class SocketNotification extends RealtimeSignal {
  const SocketNotification(this.json);
  final Map<String, dynamic> json;
}

/// Canal servidor → cliente (substituível nos testes).
abstract class RealtimeTransport {
  Stream<RealtimeSignal> get signals;

  /// Conecta; [token] é consultado a cada tentativa (inclusive nas reconexões automáticas).
  void connect(String? Function() token);
  void reconnect();
  void disconnect();
  void dispose();
}

class SocketIoTransport implements RealtimeTransport {
  SocketIoTransport({String? url}) : _url = url ?? AppConfig.apiBaseUrl;

  final String _url;
  final _signals = StreamController<RealtimeSignal>.broadcast();
  io.Socket? _socket;

  @override
  Stream<RealtimeSignal> get signals => _signals.stream;

  @override
  void connect(String? Function() token) {
    _socket?.dispose();
    final socket = io.io(
      _url,
      io.OptionBuilder()
          .setTransports(['websocket'])
          .disableAutoConnect()
          .enableForceNew()
          // Reconexão automática com backoff exponencial (1 s → 15 s) e variação aleatória.
          .enableReconnection()
          .setReconnectionDelay(1000)
          .setReconnectionDelayMax(15000)
          .setRandomizationFactor(0.5)
          .setAuthFn((callback) => callback({'token': token() ?? ''}))
          .build(),
    );
    socket
      ..onConnect((_) => _emit(const SocketConnected()))
      ..onDisconnect((reason) => _emit(SocketDisconnected(byServer: reason == 'io server disconnect')))
      ..onConnectError((error) => _emit(SocketConnectError(unauthorized: '$error'.contains('unauthorized'))))
      ..on('event', (data) {
        if (data is Map) _emit(SocketEvent(Map<String, dynamic>.from(data)));
      })
      ..on('notification', (data) {
        if (data is Map) _emit(SocketNotification(Map<String, dynamic>.from(data)));
      });
    _socket = socket..connect();
  }

  @override
  void reconnect() => _socket?.connect();

  @override
  void disconnect() => _socket?.disconnect();

  @override
  void dispose() {
    _socket?.dispose();
    _socket = null;
    _signals.close();
  }

  void _emit(RealtimeSignal signal) {
    if (!_signals.isClosed) _signals.add(signal);
  }
}
