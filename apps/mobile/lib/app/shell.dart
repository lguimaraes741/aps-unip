import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../core/providers.dart';
import '../core/push/push_controller.dart';
import '../core/widgets/states.dart';
import '../domain/models.dart';
import '../features/alerts/alerts_state.dart';
import '../features/map/map_state.dart';
import '../features/occurrences/my_reports_page.dart';
import '../features/profile/profile_pages.dart';
import 'realtime.dart';

/// Estrutura das abas principais: barra de navegação inferior + aviso de "sem conexão".
/// Quando a conexão volta, os dados são recarregados do estado persistido na API.
/// Também mantém o canal de tempo real ativo enquanto o usuário está logado.
class AppShell extends ConsumerWidget {
  const AppShell({super.key, required this.shell});

  final StatefulNavigationShell shell;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    ref.watch(realtimeProvider);
    ref.listen<AsyncValue<bool>>(connectivityProvider, (previous, next) {
      final wasOffline = previous?.value == false;
      if (wasOffline && next.value == true) {
        ref.invalidate(nearbyOccurrencesProvider);
        ref.invalidate(myReportsProvider);
        ref.invalidate(mySummaryProvider);
        ref.invalidate(notificationPreferencesProvider);
        ref.invalidate(unreadAlertsProvider);
      }
    });
    ref.listen<AppNotification?>(incomingAlertProvider, (_, alert) {
      if (alert != null) _showIncoming(context, alert);
    });
    // Toque em notificação (app fechado ou em segundo plano): abre a ocorrência.
    final openFromPush = ref.watch(pushOpenProvider);
    if (openFromPush != null) {
      WidgetsBinding.instance.addPostFrameCallback((_) {
        ref.read(pushOpenProvider.notifier).consumed();
        if (!context.mounted) return;
        // Abas do shell trocam de aba; telas de detalhe empilham por cima.
        const tabs = {'/map', '/alerts', '/my-reports', '/profile'};
        tabs.contains(openFromPush) ? context.go(openFromPush) : context.push(openFromPush);
      });
    }
    final offline = ref.watch(connectivityProvider).value == false;
    final unread = ref.watch(unreadAlertsProvider).value ?? 0;

    return Scaffold(
      body: Column(children: [
        if (offline) const OfflineBanner(),
        Expanded(child: shell),
      ]),
      bottomNavigationBar: NavigationBar(
        selectedIndex: shell.currentIndex,
        onDestinationSelected: (i) => shell.goBranch(i, initialLocation: i == shell.currentIndex),
        destinations: [
          const NavigationDestination(icon: Icon(Icons.map_outlined), selectedIcon: Icon(Icons.map), label: 'Mapa'),
          NavigationDestination(
            icon: Badge(
              isLabelVisible: unread > 0,
              label: Text(unread > 99 ? '99+' : '$unread'),
              child: const Icon(Icons.notifications_outlined),
            ),
            selectedIcon: Badge(
              isLabelVisible: unread > 0,
              label: Text(unread > 99 ? '99+' : '$unread'),
              child: const Icon(Icons.notifications),
            ),
            label: 'Alertas',
            tooltip: unread > 0 ? 'Alertas, $unread não lido${unread == 1 ? '' : 's'}' : 'Alertas',
          ),
          const NavigationDestination(icon: Icon(Icons.assignment_outlined), selectedIcon: Icon(Icons.assignment), label: 'Registros', tooltip: 'Meus registros'),
          const NavigationDestination(icon: Icon(Icons.person_outline), selectedIcon: Icon(Icons.person), label: 'Perfil'),
        ],
      ),
    );
  }

  void _showIncoming(BuildContext context, AppNotification alert) {
    final messenger = ScaffoldMessenger.maybeOf(context);
    if (messenger == null) return;
    messenger
      ..hideCurrentSnackBar()
      ..showSnackBar(SnackBar(
        content: Text(alert.title, maxLines: 2, overflow: TextOverflow.ellipsis),
        behavior: SnackBarBehavior.floating,
        duration: const Duration(seconds: 6),
        action: alert.occurrenceId == null
            ? null
            : SnackBarAction(label: 'Ver', onPressed: () => context.push('/occurrences/${alert.occurrenceId}')),
      ));
  }
}
