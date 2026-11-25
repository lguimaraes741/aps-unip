import 'package:alertacidade/core/location/address_lookup.dart';
import 'package:alertacidade/core/location/location_service.dart';
import 'package:alertacidade/core/providers.dart';
import 'package:alertacidade/features/occurrences/new_occurrence_page.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:latlong2/latlong.dart';
import 'package:material_ui/material_ui.dart';
import 'package:shared_preferences/shared_preferences.dart';

class _FakeLocation implements LocationService {
  @override
  Future<LocationResult> current({bool request = true}) async =>
      const LocationResult(LocationStatus.granted, LatLng(-23.55052, -46.63331));
  @override
  Future<bool> openSettings() async => true;
}

class _FakeLookup implements AddressLookup {
  _FakeLookup(this.result);
  final ResolvedAddress? result;
  int calls = 0;

  @override
  Future<ResolvedAddress?> fromCoordinates(double latitude, double longitude) async {
    calls++;
    return result;
  }
}

Future<void> _open(WidgetTester tester, AddressLookup lookup, {Map<String, Object> prefs = const {}}) async {
  SharedPreferences.setMockInitialValues(prefs);
  await tester.pumpWidget(ProviderScope(
    overrides: [
      locationServiceProvider.overrideWithValue(_FakeLocation()),
      addressLookupProvider.overrideWithValue(lookup),
    ],
    child: const MaterialApp(home: NewOccurrencePage()),
  ));
  for (var i = 0; i < 10; i++) {
    await tester.pump(const Duration(milliseconds: 100));
  }
}

String _fieldText(WidgetTester tester, String label) =>
    tester.widget<EditableText>(find.descendant(of: find.widgetWithText(TextFormField, label), matching: find.byType(EditableText))).controller.text;

void main() {
  setUpAll(() => initializeDateFormatting('pt_BR'));

  group('DeviceAddressLookup.describe', () {
    test('monta "rua, número" e o bairro', () {
      final r = DeviceAddressLookup.describe(thoroughfare: 'Praça da Sé', number: '108', subLocality: 'Sé');
      expect(r?.address, 'Praça da Sé, 108');
      expect(r?.neighborhood, 'Sé');
    });

    test('sem número usa só a rua; sem rua usa o nome do local', () {
      expect(DeviceAddressLookup.describe(thoroughfare: 'Av. do Estado')?.address, 'Av. do Estado');
      expect(DeviceAddressLookup.describe(street: 'Parque Dom Pedro II')?.address, 'Parque Dom Pedro II');
    });

    test('descarta respostas inúteis (coordenadas, "Unnamed Road", vazio)', () {
      expect(DeviceAddressLookup.describe(street: '-23.55, -46.63'), isNull);
      expect(DeviceAddressLookup.describe(street: 'Unnamed Road'), isNull);
      expect(DeviceAddressLookup.describe(thoroughfare: '  '), isNull);
    });
  });

  group('Registro: endereço automático pela localização', () {
    testWidgets('ao abrir, usa o GPS e preenche endereço e bairro', (tester) async {
      final lookup = _FakeLookup(const ResolvedAddress(address: 'Praça da Sé, 108', neighborhood: 'Sé'));
      await _open(tester, lookup);
      expect(lookup.calls, 1);
      expect(_fieldText(tester, 'Endereço ou ponto de referência'), 'Praça da Sé, 108');
      expect(_fieldText(tester, 'Bairro (opcional)'), 'Sé');
      expect(find.text('Preenchido pela localização. Confira e ajuste se precisar.'), findsOneWidget);
    });

    testWidgets('não sobrescreve o endereço que o usuário digitou', (tester) async {
      final lookup = _FakeLookup(const ResolvedAddress(address: 'Praça da Sé, 108', neighborhood: 'Sé'));
      await _open(tester, lookup, prefs: {
        'alertacidade.draft.new_occurrence':
            '{"clientRequestId":"t-1","address":"Em frente à padaria","latitude":-23.5,"longitude":-46.6}',
      });
      await tester.tap(find.text('Usar GPS'));
      for (var i = 0; i < 10; i++) {
        await tester.pump(const Duration(milliseconds: 100));
      }
      expect(_fieldText(tester, 'Endereço ou ponto de referência'), 'Em frente à padaria');
      // O bairro estava vazio, então pode ser preenchido.
      expect(_fieldText(tester, 'Bairro (opcional)'), 'Sé');
    });

    testWidgets('sem resultado, pede para digitar', (tester) async {
      await _open(tester, _FakeLookup(null));
      expect(_fieldText(tester, 'Endereço ou ponto de referência'), isEmpty);
      expect(find.text('Não encontramos o endereço automaticamente. Digite a rua ou uma referência.'), findsOneWidget);
    });
  });
}
