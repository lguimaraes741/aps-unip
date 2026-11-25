import 'package:alertacidade/core/config/app_config.dart';
import 'package:alertacidade/core/config/server_settings.dart';
import 'package:alertacidade/core/providers.dart';
import 'package:alertacidade/core/storage/token_storage.dart';
import 'package:alertacidade/core/theme/app_theme.dart';
import 'package:alertacidade/features/auth/server_settings_tile.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:material_ui/material_ui.dart';
import 'package:shared_preferences/shared_preferences.dart';

void main() {
  setUp(() {
    SharedPreferences.setMockInitialValues({});
    AppConfig.setOverride(null);
  });
  tearDown(() => AppConfig.setOverride(null));

  group('normalizeServerUrl', () {
    test('aceita o endereço do túnel em várias formas', () {
      const t = 'https://andrea-observation-jan-newton.trycloudflare.com';
      for (final input in [t, '$t/', '$t/api/v1', '$t/api/v1/', '  andrea-observation-jan-newton.trycloudflare.com  ']) {
        expect(normalizeServerUrl(input), t, reason: input);
      }
      expect(normalizeServerUrl('http://192.168.0.15:3000'), 'http://192.168.0.15:3000');
    });

    test('recusa vazio, outros esquemas, credenciais e parâmetros', () {
      for (final input in ['', '   ', 'ftp://x.com', 'javascript:alert(1)', 'https://user:senha@x.com', 'https://x.com/?a=1', 'https://']) {
        expect(normalizeServerUrl(input), isNull, reason: input);
      }
    });
  });

  group('ServerSettings', () {
    test('sem nada salvo usa o endereço da compilação; salvo tem prioridade; voltar ao padrão apaga', () async {
      await ServerSettings.load();
      expect(AppConfig.hasOverride, isFalse);
      expect(AppConfig.apiBaseUrl, AppConfig.builtInBaseUrl);

      await ServerSettings.save('https://novo.trycloudflare.com');
      expect(AppConfig.apiBaseUrl, 'https://novo.trycloudflare.com');
      expect(AppConfig.apiUrl, 'https://novo.trycloudflare.com/api/v1');
      expect(AppConfig.absoluteUrl('/api/v1/photos/x'), 'https://novo.trycloudflare.com/api/v1/photos/x');

      AppConfig.setOverride(null);
      await ServerSettings.load(); // como numa nova abertura do app
      expect(AppConfig.apiBaseUrl, 'https://novo.trycloudflare.com');

      await ServerSettings.reset();
      expect(AppConfig.apiBaseUrl, AppConfig.builtInBaseUrl);
      expect((await SharedPreferences.getInstance()).getString(ServerSettings.prefsKey), isNull);
    });

    test('valor salvo corrompido é ignorado', () async {
      SharedPreferences.setMockInitialValues({ServerSettings.prefsKey: 'javascript:alert(1)'});
      await ServerSettings.load();
      expect(AppConfig.hasOverride, isFalse);
    });
  });

  group('janela "Servidor" na tela de login', () {
    late List<String> checked;
    late ServerCheck answer;
    late ProviderContainer container;

    Future<void> pump(WidgetTester tester) async {
      checked = [];
      container = ProviderContainer(overrides: [
        tokenStorageProvider.overrideWithValue(InMemoryTokenStorage()),
        serverCheckProvider.overrideWithValue((url) async {
          checked.add(url);
          return answer;
        }),
      ]);
      addTearDown(container.dispose);
      await tester.pumpWidget(UncontrolledProviderScope(
        container: container,
        child: MaterialApp(theme: AppTheme.light(), home: const Scaffold(body: ServerSettingsTile())),
      ));
      await tester.tap(find.byKey(const ValueKey('server-settings')));
      await tester.pumpAndSettle();
    }

    testWidgets('endereço inválido não chega a ser testado', (tester) async {
      answer = ServerCheck.ok;
      await pump(tester);
      await tester.enterText(find.byKey(const ValueKey('server-url')), 'ftp://x');
      await tester.tap(find.text('Testar e salvar'));
      await tester.pumpAndSettle();
      expect(find.textContaining('Endereço inválido'), findsOneWidget);
      expect(checked, isEmpty);
      expect(AppConfig.hasOverride, isFalse);
    });

    testWidgets('servidor fora do ar: mostra o erro e NÃO salva', (tester) async {
      answer = ServerCheck.unreachable;
      await pump(tester);
      await tester.enterText(find.byKey(const ValueKey('server-url')), 'fora.trycloudflare.com');
      await tester.tap(find.text('Testar e salvar'));
      await tester.pumpAndSettle();
      expect(checked, ['https://fora.trycloudflare.com']);
      expect(find.textContaining('não respondeu'), findsOneWidget);
      expect(AppConfig.hasOverride, isFalse);
    });

    testWidgets('servidor que não é do AlertaCidade é recusado', (tester) async {
      answer = ServerCheck.notAlertaCidade;
      await pump(tester);
      await tester.enterText(find.byKey(const ValueKey('server-url')), 'https://exemplo.com');
      await tester.tap(find.text('Testar e salvar'));
      await tester.pumpAndSettle();
      expect(find.textContaining('não é um servidor do AlertaCidade'), findsOneWidget);
      expect(AppConfig.hasOverride, isFalse);
    });

    testWidgets('endereço válido e no ar: salva, troca na hora o cliente HTTP e mostra na tela; "Usar padrão" desfaz', (tester) async {
      answer = ServerCheck.ok;
      await pump(tester);
      await tester.enterText(find.byKey(const ValueKey('server-url')), 'https://novo.trycloudflare.com/api/v1/');
      await tester.tap(find.text('Testar e salvar'));
      await tester.pumpAndSettle();
      expect(checked, ['https://novo.trycloudflare.com']);
      expect(AppConfig.apiBaseUrl, 'https://novo.trycloudflare.com');
      expect(container.read(apiClientProvider).dio.options.baseUrl, 'https://novo.trycloudflare.com/api/v1');
      expect(find.text('Servidor: novo.trycloudflare.com (personalizado)'), findsOneWidget);
      expect(find.text('Servidor atualizado.'), findsOneWidget);

      await tester.tap(find.byKey(const ValueKey('server-settings')));
      await tester.pumpAndSettle();
      await tester.tap(find.text('Usar padrão'));
      await tester.pumpAndSettle();
      expect(AppConfig.hasOverride, isFalse);
      expect(container.read(apiClientProvider).dio.options.baseUrl, AppConfig.apiUrl);
    });
  });
}
