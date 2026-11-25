import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../core/theme/app_theme.dart';
import 'router.dart';

class AlertaCidadeApp extends ConsumerWidget {
  const AlertaCidadeApp({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    return MaterialApp.router(
      title: 'AlertaCidade',
      debugShowCheckedModeBanner: false,
      theme: AppTheme.light(),
      routerConfig: ref.watch(routerProvider),
      locale: const Locale('pt', 'BR'),
      supportedLocales: const [Locale('pt', 'BR')],
      localizationsDelegates: GlobalMaterialLocalizations.delegates,
      // go_router e flutter_map ainda importam package:flutter/material.dart (obsoleto);
      // a ponte faz o tema e as traduções valerem também para os widgets deles.
      // ignore: deprecated_member_use -- remover quando esses pacotes migrarem para material_ui.
      builder: (context, child) => MaterialUiCompatibilityBridge(child: child!),
    );
  }
}
