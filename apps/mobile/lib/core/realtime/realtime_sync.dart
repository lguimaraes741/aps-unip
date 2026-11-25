import 'dart:async';

import '../../domain/models.dart';

typedef SyncFetcher = Future<SyncResult> Function(BigInt? since);

/// Mantém o app coerente com o servidor a partir do cursor de entrega (`sequence`).
///
/// Regras (ver docs/architecture/01-arquitetura.md, "Sincronização após desconexão"):
///  - evento com sequence ≤ cursor → duplicata (reentrega "pelo menos uma vez"): ignorado;
///  - sequence = cursor + 1 → aplicado;
///  - sequence > cursor + 1 → lacuna (eventos perdidos, ou números pulados por uma
///    publicação desfeita): busca `GET /sync?since=cursor`, que devolve tudo em ordem;
///  - (re)conexão → mesma ressincronização; sem cursor, pega o atual e recarrega tudo;
///  - `reset` (cursor maior que o do servidor, banco recriado) → recarrega tudo.
///
/// O app nunca depende só do evento em memória: o estado persistido na API é a fonte da verdade.
class RealtimeSync {
  RealtimeSync({required this.fetch, required this.onEvent, required this.onReload});

  final SyncFetcher fetch;

  /// Um evento novo, na ordem do cursor.
  final void Function(DomainEvent event) onEvent;

  /// O estado local pode estar desatualizado de forma desconhecida: recarregar tudo da API.
  final void Function() onReload;

  BigInt? _cursor;
  Future<void>? _running;
  bool _again = false;

  BigInt? get cursor => _cursor;

  /// Esquece o cursor (logout): a próxima conexão recomeça do zero.
  void clear() => _cursor = null;

  /// Evento recebido pelo socket.
  Future<void> receive(DomainEvent event) async {
    final cursor = _cursor;
    // Sem cursor, uma ressincronização está em curso e o recarregamento cobre este evento.
    if (cursor == null) return resync();
    if (event.sequence <= cursor) return;
    if (event.sequence == cursor + BigInt.one) {
      _cursor = event.sequence;
      onEvent(event);
      return;
    }
    return resync();
  }

  /// Busca o que falta. Chamadas simultâneas são unidas: no máximo uma em andamento
  /// e, se outra for pedida durante ela, uma rodada extra no final.
  Future<void> resync() {
    if (_running != null) {
      _again = true;
      return _running!;
    }
    final completer = Completer<void>();
    _running = completer.future;
    () async {
      try {
        do {
          _again = false;
          await _pull();
        } while (_again);
        completer.complete();
      } catch (e, s) {
        completer.completeError(e, s);
      } finally {
        _running = null;
      }
    }();
    return completer.future;
  }

  Future<void> _pull() async {
    if (_cursor == null) {
      final head = await fetch(null);
      _cursor = head.cursor;
      onReload();
      return;
    }
    while (true) {
      final result = await fetch(_cursor);
      if (result.reset) {
        _cursor = result.cursor;
        onReload();
        return;
      }
      for (final event in result.events) {
        if (event.sequence > _cursor!) {
          _cursor = event.sequence;
          onEvent(event);
        }
      }
      if (result.cursor > _cursor!) _cursor = result.cursor;
      if (!result.hasMore) return;
    }
  }
}
