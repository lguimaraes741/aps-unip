import 'package:alertacidade/core/network/api_client.dart';
import 'package:alertacidade/core/network/api_exception.dart';
import 'package:alertacidade/core/providers.dart';
import 'package:alertacidade/core/storage/token_storage.dart';
import 'package:alertacidade/core/theme/app_theme.dart';
import 'package:alertacidade/core/widgets/badges.dart';
import 'package:alertacidade/core/widgets/buttons.dart';
import 'package:alertacidade/core/widgets/occurrence_card.dart';
import 'package:alertacidade/core/widgets/states.dart';
import 'package:alertacidade/data/auth_repository.dart';
import 'package:alertacidade/domain/models.dart';
import 'package:alertacidade/features/auth/auth_pages.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:material_ui/material_ui.dart';
import 'package:mocktail/mocktail.dart';

import 'models_test.dart' show summaryJson;

class MockAuthRepository extends Mock implements AuthRepository {}

Widget wrap(Widget child, {List overrides = const []}) => ProviderScope(
      overrides: [...overrides],
      child: MaterialApp(theme: AppTheme.light(), home: Scaffold(body: child)),
    );

void main() {
  setUpAll(() => initializeDateFormatting('pt_BR'));

  testWidgets('badges exibem texto (cor nunca é o único indicador)', (tester) async {
    await tester.pumpWidget(wrap(const Column(children: [
      SeverityBadge(Severity.critical),
      StatusBadge(OccurrenceStatus.underReview),
      DemoBadge(),
    ])));
    expect(find.text('Crítica'), findsOneWidget);
    expect(find.text('Em análise'), findsOneWidget);
    expect(find.text('Demonstração'), findsOneWidget);
    expect(find.byIcon(Icons.manage_search), findsOneWidget);
  });

  testWidgets('OccurrenceCard mostra gravidade, status, distância e selo de demonstração', (tester) async {
    var tapped = false;
    final o = OccurrenceSummary.fromJson(summaryJson(overrides: {'coverPhotoUrl': null}));
    await tester.pumpWidget(wrap(OccurrenceCard(occurrence: o, onTap: () => tapped = true)));
    expect(find.text('Alagamento na Av. do Estado'), findsOneWidget);
    expect(find.text('Alta'), findsOneWidget);
    expect(find.text('Validada'), findsOneWidget);
    expect(find.text('Demonstração'), findsOneWidget);
    expect(find.textContaining('1,2 km'), findsOneWidget);
    await tester.tap(find.byType(OccurrenceCard));
    expect(tapped, isTrue);
  });

  testWidgets('PrimaryButton em carregamento fica desabilitado (sem envio duplicado)', (tester) async {
    var taps = 0;
    await tester.pumpWidget(wrap(PrimaryButton(label: 'Enviar', loading: true, onPressed: () => taps++)));
    await tester.tap(find.byType(FilledButton));
    expect(taps, 0);
    expect(find.byType(CircularProgressIndicator), findsOneWidget);
  });

  testWidgets('ErrorState diferencia falta de conexão e oferece nova tentativa', (tester) async {
    var retried = false;
    await tester.pumpWidget(wrap(ErrorState(
      error: const ApiException(ApiErrorKind.network, 'Sem conexão com o servidor.'),
      onRetry: () => retried = true,
    )));
    expect(find.text('Sem conexão'), findsOneWidget);
    await tester.tap(find.text('Tentar novamente'));
    expect(retried, isTrue);
  });

  group('LoginPage', () {
    late MockAuthRepository auth;
    late List overrides;

    setUp(() {
      auth = MockAuthRepository();
      when(() => auth.restore()).thenAnswer((_) async => null);
      final storage = InMemoryTokenStorage();
      overrides = [
        tokenStorageProvider.overrideWithValue(storage),
        apiClientProvider.overrideWithValue(ApiClient(storage: storage)),
        authRepositoryProvider.overrideWithValue(auth),
      ];
    });

    testWidgets('valida campos antes de chamar a API', (tester) async {
      await tester.pumpWidget(wrap(const LoginPage(), overrides: overrides));
      await tester.tap(find.widgetWithText(FilledButton, 'Entrar'));
      await tester.pump();
      expect(find.text('Informe seu e-mail'), findsOneWidget);
      expect(find.text('Informe sua senha'), findsOneWidget);
      verifyNever(() => auth.login(email: any(named: 'email'), password: any(named: 'password')));
    });

    testWidgets('exibe a mensagem de erro da API', (tester) async {
      when(() => auth.login(email: any(named: 'email'), password: any(named: 'password')))
          .thenThrow(const ApiException(ApiErrorKind.unauthorized, 'E-mail ou senha incorretos', statusCode: 401));
      await tester.pumpWidget(wrap(const LoginPage(), overrides: overrides));
      await tester.enterText(find.widgetWithText(TextFormField, 'E-mail'), 'maria@email.com');
      await tester.enterText(find.widgetWithText(TextFormField, 'Senha'), 'Errada@123');
      await tester.tap(find.widgetWithText(FilledButton, 'Entrar'));
      await tester.pumpAndSettle();
      expect(find.text('E-mail ou senha incorretos'), findsOneWidget);
      verify(() => auth.login(email: 'maria@email.com', password: 'Errada@123')).called(1);
    });
  });
}
