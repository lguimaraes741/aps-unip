import 'package:firebase_core/firebase_core.dart';
import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:intl/date_symbol_data_local.dart';
import 'package:material_ui/material_ui.dart';

import 'app/app.dart';
import 'core/config/server_settings.dart';
import 'core/push/push_controller.dart';
import 'core/push/push_messaging.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await initializeDateFormatting('pt_BR');
  // Endereço do servidor salvo no aparelho (antes de criar o cliente HTTP).
  await ServerSettings.load();

  // Push via Firebase quando o app foi compilado com android/app/google-services.json.
  // Sem ele (ou sem Google Play Services), o app funciona normalmente sem push.
  PushMessaging push = const DisabledPushMessaging();
  try {
    await Firebase.initializeApp();
    push = FirebasePushMessaging();
  } catch (error) {
    debugPrint('Push desativado: Firebase indisponível ($error)');
  }

  runApp(ProviderScope(
    overrides: [pushMessagingProvider.overrideWithValue(push)],
    child: const AlertaCidadeApp(),
  ));
}
