import 'package:alertacidade/data/occurrences_repository.dart';
import 'package:alertacidade/domain/models.dart';
import 'package:alertacidade/features/occurrences/occurrence_draft.dart';
import 'package:flutter_test/flutter_test.dart';

/// JSON no formato exato devolvido pela API (apps/api/src/occurrences/occurrence-view.ts).
Map<String, dynamic> summaryJson({Map<String, dynamic> overrides = const {}}) => {
      'id': '7c1f7a9e-1111-4c1b-9a51-0e5e2a7f0001',
      'code': 1042,
      'title': 'Alagamento na Av. do Estado',
      'address': 'Av. do Estado, 100',
      'neighborhood': 'Cambuci',
      'latitude': -23.5662,
      'longitude': -46.6205,
      'severity': 'HIGH',
      'status': 'VALIDATED',
      'occurredAt': '2026-11-23T13:00:00.000Z',
      'createdAt': '2026-11-23T13:05:00.000Z',
      'updatedAt': '2026-11-23T13:30:00.000Z',
      'confirmCount': 3,
      'contestCount': 1,
      'coverPhotoUrl': '/api/v1/photos/abc',
      'distanceMeters': 1234,
      'isDemo': true,
      ...overrides,
    };

void main() {
  group('OccurrenceSummary', () {
    test('converte a resposta da API, com datas em UTC', () {
      final o = OccurrenceSummary.fromJson(summaryJson());
      expect(o.code, 1042);
      expect(o.severity, Severity.high);
      expect(o.status, OccurrenceStatus.validated);
      expect(o.createdAt.isUtc, isTrue);
      expect(o.createdAt, DateTime.utc(2026, 11, 23, 13, 5));
      expect(o.distanceMeters, 1234);
      expect(o.isDemo, isTrue);
    });

    test('campos opcionais ausentes', () {
      final json = summaryJson()..remove('distanceMeters')..remove('updatedAt');
      json['coverPhotoUrl'] = null;
      json['neighborhood'] = null;
      final o = OccurrenceSummary.fromJson(json);
      expect(o.distanceMeters, isNull);
      expect(o.coverPhotoUrl, isNull);
      expect(o.updatedAt, o.createdAt);
    });

    test('gravidade ou status desconhecidos geram erro explícito', () {
      expect(() => OccurrenceSummary.fromJson(summaryJson(overrides: {'severity': 'EXTREMA'})), throwsFormatException);
      expect(() => OccurrenceSummary.fromJson(summaryJson(overrides: {'status': 'X'})), throwsFormatException);
    });
  });

  test('OccurrenceDetail: fotos, linha do tempo, manifestação e regra de confirmação', () {
    final d = OccurrenceDetail.fromJson({
      ...summaryJson(),
      'description': 'Água cobrindo duas faixas.',
      'resolvedAt': null,
      'isMine': false,
      'isSaved': true,
      'myConfirmation': 'CONFIRM',
      'reporter': {'firstName': 'Maria'},
      'moderationNote': null,
      'photos': [
        {'id': 'p1', 'url': '/api/v1/photos/p1', 'width': 1920, 'height': 1080},
      ],
      'history': [
        {'fromStatus': null, 'toStatus': 'PENDING', 'note': null, 'createdAt': '2026-11-23T13:05:00.000Z', 'actor': 'CITIZEN'},
        {'fromStatus': 'PENDING', 'toStatus': 'VALIDATED', 'note': 'Confirmado', 'createdAt': '2026-11-23T13:30:00.000Z', 'actor': 'MODERATION'},
      ],
    });
    expect(d.photos.single.width, 1920);
    expect(d.history.last.byModeration, isTrue);
    expect(d.myConfirmation, ConfirmationType.confirm);
    expect(d.reporterFirstName, 'Maria');
    expect(d.acceptsConfirmation, isTrue);

    final updated = d.copyWith(confirmCount: 4, myConfirmation: () => null);
    expect(updated.confirmCount, 4);
    expect(updated.myConfirmation, isNull);
    expect(updated.isSaved, isTrue);
  });

  test('Paged calcula se há mais páginas', () {
    final p = Paged.fromJson({'items': [summaryJson()], 'total': 45, 'page': 2, 'limit': 20}, OccurrenceSummary.fromJson);
    expect(p.hasMore, isTrue);
    expect(Paged.fromJson({'items': [], 'total': 40, 'page': 2, 'limit': 20}, OccurrenceSummary.fromJson).hasMore, isFalse);
  });

  test('UserProfile: iniciais e primeiro nome', () {
    final u = UserProfile.fromJson({'id': '1', 'name': 'Maria da Silva Souza', 'email': 'm@x.com', 'role': 'MODERATOR'});
    expect(u.initials, 'MS');
    expect(u.firstName, 'Maria');
    expect(u.role, UserRole.moderator);
    expect(UserProfile.fromJson(u.toJson()).email, 'm@x.com');
  });

  group('OccurrenceFilters.toQuery', () {
    test('envia apenas os filtros definidos, no formato da API', () {
      const f = OccurrenceFilters(
        severities: {Severity.high, Severity.critical},
        statuses: {OccurrenceStatus.resolved},
        radiusMeters: 2000,
        periodHours: 24,
        query: '  Cambuci ',
      );
      final q = f.toQuery(lat: -23.5, lng: -46.6);
      expect(q['lat'], -23.5);
      expect(q['radius'], 2000);
      expect((q['severity'] as String).split(',').toSet(), {'HIGH', 'CRITICAL'});
      expect(q['status'], 'RESOLVED');
      expect(q['periodHours'], 24);
      expect(q['q'], 'Cambuci');
    });

    test('sem localização não envia raio', () {
      expect(const OccurrenceFilters().toQuery(), isEmpty);
      expect(const OccurrenceFilters().isDefault, isTrue);
    });
  });

  group('NewOccurrence e rascunho', () {
    test('serializa a data em UTC e omite bairro vazio', () {
      final json = NewOccurrence(
        clientRequestId: 'id',
        title: 't',
        description: 'd',
        address: 'a',
        neighborhood: '',
        latitude: 1,
        longitude: 2,
        severity: Severity.low,
        occurredAt: DateTime.utc(2026, 1, 1, 12),
      ).toJson();
      expect(json['occurredAt'], '2026-01-01T12:00:00.000Z');
      expect(json.containsKey('neighborhood'), isFalse);
      expect(json['severity'], 'LOW');
    });

    test('o rascunho preserva a chave de idempotência e as fotos pendentes', () {
      final draft = OccurrenceDraft(title: 'Teste', latitude: -23.5, longitude: -46.6, severity: Severity.critical, photoPaths: ['a.jpg', 'b.jpg'])
        ..createdOccurrenceId = 'occ-1'
        ..uploadedPhotoPaths = ['a.jpg'];
      final restored = OccurrenceDraft.fromJson(draft.toJson());
      expect(restored.clientRequestId, draft.clientRequestId);
      expect(restored.severity, Severity.critical);
      expect(restored.pendingPhotos, ['b.jpg']);
      expect(restored.createdOccurrenceId, 'occ-1');
      expect(OccurrenceDraft().isEmpty, isTrue);
      expect(OccurrenceDraft().clientRequestId, isNot(OccurrenceDraft().clientRequestId));
    });
  });
}
