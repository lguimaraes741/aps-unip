import 'package:alertacidade/domain/models.dart';
import 'package:flutter_test/flutter_test.dart';

/// Fase 7: o servidor passa a emitir eventos e alertas de NOTÍCIA. Antes deste ajuste,
/// um `news.alert.*` no /sync derrubava a sincronização inteira (cast de occurrenceId) e um
/// alerta NEWS_ALERT fazia a caixa de alertas mostrar erro (tipo desconhecido lançava exceção).
void main() {
  group('compatibilidade com notícias', () {
    test('evento news.alert.* no /sync é lido (sem occurrenceId)', () {
      final sync = SyncResult.fromJson({
        'events': [
          {
            'eventId': 'e1',
            'sequence': '41',
            'type': 'occurrence.created',
            'occurredAt': '2026-11-24T12:00:00.000Z',
            'payload': {'occurrenceId': 'o1', 'code': 1, 'severity': 'HIGH', 'status': 'PENDING', 'latitude': -23.5, 'longitude': -46.6, 'neighborhood': null, 'version': 1},
          },
          {
            'eventId': 'e2',
            'sequence': '42',
            'type': 'news.alert.published',
            'occurredAt': '2026-11-24T12:01:00.000Z',
            'payload': {'alertId': 'a1', 'eventId': 'n1', 'code': 15, 'severity': 'HIGH', 'level': 'PRELIMINARY', 'status': 'ACTIVE'},
          },
        ],
        'cursor': '42',
        'hasMore': false,
      });
      expect(sync.events, hasLength(2));
      expect(sync.events[0].occurrenceId, 'o1');
      expect(sync.events[1].occurrenceId, isNull);
      expect(sync.events[1].isNews, isTrue);
      expect(sync.events[1].newsEventId, 'n1');
      expect(sync.cursor, BigInt.from(42));
    });

    test('tipos de alerta de notícia são reconhecidos; tipo futuro desconhecido não lança', () {
      expect(NotificationKind.fromApi('NEWS_ALERT'), NotificationKind.newsAlert);
      expect(NotificationKind.fromApi('NEWS_ALERT_UPDATE').isNews, isTrue);
      expect(NotificationKind.fromApi('ALGO_DO_FUTURO'), NotificationKind.other);
      expect(NotificationKind.fromApi(''), NotificationKind.other);
      expect(NotificationKind.fromApi('OCCURRENCE_NEARBY'), NotificationKind.nearby);
    });

    test('alerta de notícia na caixa de alertas: sem ocorrência, com o evento de notícia', () {
      final n = AppNotification.fromJson({
        'id': 'n-1',
        'type': 'NEWS_ALERT',
        'occurrenceId': null,
        'newsEventId': 'ev-9',
        'title': 'Alerta de alagamento — Osasco',
        'body': 'Notícia relata interdição de via por alagamento. Gravidade alta. Consulte as informações e a fonte.',
        'distanceMeters': null,
        'occurrence': null,
        'readAt': null,
        'createdAt': '2026-11-24T12:00:00.000Z',
      });
      expect(n.kind, NotificationKind.newsAlert);
      expect(n.newsEventId, 'ev-9');
      expect(n.occurrenceId, isNull);
      expect(n.markedRead(DateTime.utc(2026, 11, 24)).newsEventId, 'ev-9');
    });
  });
}
