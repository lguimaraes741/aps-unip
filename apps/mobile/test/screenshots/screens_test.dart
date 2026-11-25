// Gerador de capturas das telas REAIS do app (roteador, shell e widgets de produção),
// com repositórios falsos no lugar da rede. Usado na revisão de UX (antes/depois).
// Não roda no `flutter test` comum. Uso:
//
//   flutter test test/screenshots --update-goldens --dart-define=SCREENSHOTS=true
//
// As imagens (1080×2400, como um Android médio) ficam em test/screenshots/goldens/.
@Tags(['screenshots'])
library;

import 'dart:async';
import 'dart:io';

import 'package:alertacidade/app/app.dart';
import 'package:alertacidade/app/router.dart';
import 'package:alertacidade/core/location/address_lookup.dart';
import 'package:alertacidade/core/location/location_service.dart';
import 'package:alertacidade/core/providers.dart';
import 'package:alertacidade/core/realtime/socket_transport.dart';
import 'package:alertacidade/core/storage/token_storage.dart';
import 'package:alertacidade/core/widgets/severity_widgets.dart';
import 'package:alertacidade/data/auth_repository.dart';
import 'package:alertacidade/data/news_repository.dart';
import 'package:alertacidade/data/notifications_repository.dart';
import 'package:alertacidade/data/occurrences_repository.dart';
import 'package:alertacidade/data/users_repository.dart';
import 'package:alertacidade/domain/models.dart';
import 'package:alertacidade/domain/news.dart';
import 'package:alertacidade/features/map/map_state.dart';
import 'package:flutter/services.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:latlong2/latlong.dart';
import 'package:material_ui/material_ui.dart';
import 'package:mocktail/mocktail.dart';
import 'package:shared_preferences/shared_preferences.dart';

const enabled = bool.fromEnvironment('SCREENSHOTS');
const se = LatLng(-23.55052, -46.63331);

class MockAuth extends Mock implements AuthRepository {}

class MockOccurrences extends Mock implements OccurrencesRepository {}

class MockUsers extends Mock implements UsersRepository {}

class MockNotifications extends Mock implements NotificationsRepository {}

class _NoNews extends Fake implements NewsRepository {
  @override
  Future<Paged<NewsAlert>> list({
    double? lat,
    double? lng,
    int? radiusMeters,
    bool activeOnly = true,
    Set<Severity> severities = const {},
    int? periodHours,
    int page = 1,
    int limit = 50,
  }) async =>
      Paged(items: const [], total: 0, page: 1, limit: limit);
}

class FakeLocation implements LocationService {
  @override
  Future<LocationResult> current({bool request = true}) async => const LocationResult(LocationStatus.granted, se);
  @override
  Future<bool> openSettings() async => true;
}

class FakeAddressLookup implements AddressLookup {
  @override
  Future<ResolvedAddress?> fromCoordinates(double latitude, double longitude) async =>
      const ResolvedAddress(address: 'Praça da Sé, 108', neighborhood: 'Sé');
}

class SilentTransport implements RealtimeTransport {
  final _c = StreamController<RealtimeSignal>.broadcast();
  @override
  Stream<RealtimeSignal> get signals => _c.stream;
  @override
  void connect(String? Function() token) => _c.add(const SocketConnected());
  @override
  void reconnect() {}
  @override
  void disconnect() {}
  @override
  void dispose() => _c.close();
}

String ago(Duration d) => DateTime.now().toUtc().subtract(d).toIso8601String();

Map<String, dynamic> occ(int code, String title, String hood, double dLat, double dLng, String sev, String status,
        {int minutes = 30, int confirm = 0, int contest = 0, bool demo = true, int distance = 500}) =>
    {
      'id': 'occ-$code',
      'code': code,
      'title': title,
      'address': '$hood, São Paulo',
      'neighborhood': hood,
      'latitude': se.latitude + dLat,
      'longitude': se.longitude + dLng,
      'severity': sev,
      'status': status,
      'occurredAt': ago(Duration(minutes: minutes + 5)),
      'createdAt': ago(Duration(minutes: minutes)),
      'updatedAt': ago(Duration(minutes: minutes)),
      'confirmCount': confirm,
      'contestCount': contest,
      'coverPhotoUrl': null,
      'distanceMeters': distance,
      'isDemo': demo,
    };

final nearby = [
  occ(2, 'Ponto de alagamento na Pç. da Bandeira', 'Centro', 0.004, -0.003, 'MODERATE', 'PENDING', minutes: 12, confirm: 1, distance: 560),
  occ(4, 'Alagamento sob o viaduto na Marginal Tietê', 'Santana', 0.03, 0.002, 'HIGH', 'PENDING', minutes: 40, confirm: 4, distance: 3200),
  occ(5, 'Alagamento na Av. do Estado', 'Cambuci', -0.012, 0.012, 'CRITICAL', 'VALIDATED', minutes: 90, confirm: 9, contest: 1, distance: 1900),
];

Map<String, dynamic> detailJson() => {
      ...nearby[2],
      'description': 'Água acima do meio-fio nos dois sentidos, carros parados perto da ponte. Trânsito desviado pela Rua Independência.',
      'resolvedAt': null,
      'isMine': false,
      'isSaved': false,
      'myConfirmation': null,
      'reporter': {'firstName': 'Cidadã'},
      'moderationNote': null,
      'photos': <dynamic>[],
      'history': [
        {'fromStatus': null, 'toStatus': 'PENDING', 'note': null, 'createdAt': ago(const Duration(minutes: 90)), 'actor': 'CITIZEN'},
        {'fromStatus': 'PENDING', 'toStatus': 'VALIDATED', 'note': 'Confirmado por imagens', 'createdAt': ago(const Duration(minutes: 60)), 'actor': 'MODERATION'},
      ],
    };

Map<String, dynamic> alertJson(String id, String title, String sev, String status, {bool read = false, int minutes = 10, String type = 'OCCURRENCE_NEARBY'}) => {
      'id': id,
      'type': type,
      'occurrenceId': 'occ-5',
      'title': title,
      'body': 'Ocorrência registrada por um cidadão, ainda não verificada. Em risco, ligue 199 (Defesa Civil).',
      'distanceMeters': 420,
      'occurrence': {'code': 5, 'severity': sev, 'status': status},
      'readAt': read ? ago(const Duration(minutes: 1)) : null,
      'createdAt': ago(Duration(minutes: minutes)),
    };

Future<void> loadFonts() async {
  for (final weight in ['Regular', 'Medium', 'SemiBold', 'Bold']) {
    final loader = FontLoader('Inter')..addFont(rootBundle.load('assets/fonts/Inter-$weight.ttf'));
    await loader.load();
  }
  final icons = File('${Platform.environment['FLUTTER_ROOT'] ?? 'C:/src/flutter'}/bin/cache/artifacts/material_fonts/materialicons-regular.otf');
  final iconLoader = FontLoader('MaterialIcons')..addFont(Future.value(ByteData.sublistView(icons.readAsBytesSync())));
  await iconLoader.load();
}

void main() {
  TestWidgetsFlutterBinding.ensureInitialized();
  setUpAll(() async {
    await initializeDateFormatting('pt_BR');
    await loadFonts();
    // Cache de tiles do flutter_map usa o path_provider (plugin nativo): pasta temporária no teste.
    final cacheDir = Directory.systemTemp.createTempSync('alertacidade_tiles');
    TestDefaultBinaryMessengerBinding.instance.defaultBinaryMessenger.setMockMethodCallHandler(
      const MethodChannel('plugins.flutter.io/path_provider'),
      (_) async => cacheDir.path,
    );
    registerFallbackValue(const OccurrenceFilters());
    registerFallbackValue(MineFilter.all);
    registerFallbackValue(NotificationFilter.all);
  });

  late ProviderContainer container;

  Future<ProviderContainer> boot(WidgetTester tester, {required bool loggedIn}) async {
    // O flutter_test troca sombras por contornos pretos; nas capturas queremos as sombras reais.
    debugDisableShadows = false;
    addTearDown(() => debugDisableShadows = true);
    tester.view.physicalSize = const Size(1080, 2400);
    tester.view.devicePixelRatio = 2.625;
    addTearDown(tester.view.reset);
    SharedPreferences.setMockInitialValues({});

    final auth = MockAuth();
    when(() => auth.restore()).thenAnswer((_) async => loggedIn ? const UserProfile(id: 'u1', name: 'Cidadã Demo A', email: 'cidada.a@alertacidade.demo', role: UserRole.citizen) : null);
    final occurrences = MockOccurrences();
    when(() => occurrences.list(any(), lat: any(named: 'lat'), lng: any(named: 'lng'), page: any(named: 'page'), limit: any(named: 'limit')))
        .thenAnswer((_) async => Paged(items: nearby.map(OccurrenceSummary.fromJson).toList(), total: 3, page: 1, limit: 100));
    when(() => occurrences.detail(any(), lat: any(named: 'lat'), lng: any(named: 'lng'))).thenAnswer((_) async => OccurrenceDetail.fromJson(detailJson()));
    when(() => occurrences.mine(filter: any(named: 'filter'), query: any(named: 'query'), page: any(named: 'page')))
        .thenAnswer((_) async => Paged(items: nearby.map(OccurrenceSummary.fromJson).toList(), total: 3, page: 1, limit: 20));
    when(() => occurrences.mySummary()).thenAnswer((_) async => MySummary.fromJson({'total': 3, 'active': 3, 'pending': 2, 'resolved': 0}));
    final users = MockUsers();
    when(() => users.preferences()).thenAnswer((_) async => NotificationPreferences.fromJson(
          {'pushEnabled': true, 'radiusMeters': 3000, 'minSeverity': 'MODERATE', 'latitude': se.latitude, 'longitude': se.longitude},
        ));
    final notifications = MockNotifications();
    when(() => notifications.sync(since: any(named: 'since'))).thenAnswer((_) async => SyncResult(events: const [], cursor: BigInt.from(10), hasMore: false, reset: false));
    when(() => notifications.list(filter: any(named: 'filter'), page: any(named: 'page'), limit: any(named: 'limit'))).thenAnswer((_) async => NotificationsPage(
          page: Paged(items: [
            AppNotification.fromJson(alertJson('n1', 'Alagamento de gravidade crítica a 420 m (Cambuci)', 'CRITICAL', 'VALIDATED')),
            AppNotification.fromJson(alertJson('n2', 'Sua ocorrência #2 foi validada', 'MODERATE', 'VALIDATED', type: 'OCCURRENCE_STATUS_CHANGED', minutes: 55)),
            AppNotification.fromJson(alertJson('n3', 'Alagamento de gravidade alta a 1,2 km (Sé)', 'HIGH', 'RESOLVED', read: true, minutes: 300)),
          ], total: 3, page: 1, limit: 20),
          unread: 2,
        ));

    container = ProviderContainer(overrides: [
      tokenStorageProvider.overrideWithValue(InMemoryTokenStorage()),
      authRepositoryProvider.overrideWithValue(auth),
      occurrencesRepositoryProvider.overrideWithValue(occurrences),
      // Sem alertas de notícia nas capturas da revisão de UX (nada de rede no gerador).
      newsRepositoryProvider.overrideWithValue(_NoNews()),
      usersRepositoryProvider.overrideWithValue(users),
      notificationsRepositoryProvider.overrideWithValue(notifications),
      locationServiceProvider.overrideWithValue(FakeLocation()),
      addressLookupProvider.overrideWithValue(FakeAddressLookup()),
      realtimeTransportProvider.overrideWithValue(SilentTransport()),
      connectivityProvider.overrideWith((ref) => Stream.value(true)),
    ]);
    addTearDown(container.dispose);
    await tester.pumpWidget(UncontrolledProviderScope(container: container, child: const AlertaCidadeApp()));
    await settle(tester);
    return container;
  }

  Future<void> go(WidgetTester tester, String location) async {
    container.read(routerProvider).go(location);
    await settle(tester);
  }

  /// Telas secundárias abrem por cima (como no app), com a seta de voltar.
  Future<void> push(WidgetTester tester, String location) async {
    unawaited(container.read(routerProvider).push(location));
    await settle(tester);
  }

  Future<void> shot(WidgetTester tester, String name) async {
    await expectLater(find.byType(AlertaCidadeApp), matchesGoldenFile('goldens/$name.png'));
  }

  testWidgets('capturas das telas', (tester) async {
    await boot(tester, loggedIn: false);
    await shot(tester, '01-boas-vindas');
    await go(tester, '/login');
    await shot(tester, '02-login');

    await boot(tester, loggedIn: true);
    await go(tester, '/map');
    await container.read(userLocationProvider.notifier).locate();
    await settle(tester);
    await shot(tester, '03-mapa');
    // Toque real no marcador (aciona o mesmo código do app: reposiciona o mapa e recolhe o painel).
    final marker = find.byWidgetPredicate((w) => w is SeverityMarker && w.severity == Severity.critical);
    tester.widget<GestureDetector>(find.ancestor(of: marker, matching: find.byType(GestureDetector)).first).onTap!();
    await settle(tester);
    await shot(tester, '04-mapa-marcador-selecionado');
    await push(tester, '/occurrences/occ-5');
    await shot(tester, '05-detalhes');
    await tester.drag(find.byType(Scrollable).first, const Offset(0, -900));
    await settle(tester);
    await shot(tester, '06-detalhes-rolado');
    await go(tester, '/map');
    await push(tester, '/occurrences/new');
    await shot(tester, '07-nova-ocorrencia');
    await go(tester, '/alerts');
    await shot(tester, '08-alertas');
    await go(tester, '/my-reports');
    await shot(tester, '09-meus-registros');
    await go(tester, '/profile');
    await shot(tester, '10-perfil');
    await push(tester, '/profile/notifications');
    await shot(tester, '11-preferencias');
  }, skip: !enabled);
}

/// Espera dados e animações curtas, sem `pumpAndSettle` (skeletons e indicadores animam sem fim).
Future<void> settle(WidgetTester tester) async {
  for (var i = 0; i < 12; i++) {
    await tester.runAsync(() => Future<void>.delayed(const Duration(milliseconds: 30)));
    await tester.pump(const Duration(milliseconds: 100));
  }
}
