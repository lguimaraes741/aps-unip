import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../core/providers.dart';
import '../../core/push/push_controller.dart';
import '../../domain/models.dart';

/// Filtro escolhido na aba Alertas.
class AlertsFilterNotifier extends Notifier<NotificationFilter> {
  @override
  NotificationFilter build() => NotificationFilter.all;

  void set(NotificationFilter filter) => state = filter;
}

final alertsFilterProvider = NotifierProvider<AlertsFilterNotifier, NotificationFilter>(AlertsFilterNotifier.new);

/// Caixa de alertas do filtro atual, com paginação ("carregar mais").
class AlertsNotifier extends AsyncNotifier<Paged<AppNotification>> {
  static const pageSize = 20;

  @override
  Future<Paged<AppNotification>> build() async {
    final filter = ref.watch(alertsFilterProvider);
    ref.watch(pushTickProvider); // push com o app aberto: recarrega
    final result = await ref.read(notificationsRepositoryProvider).list(filter: filter, limit: pageSize);
    return result.page;
  }

  Future<void> loadMore() async {
    final current = state.value;
    if (current == null || !current.hasMore || state.isLoading) return;
    final next = await ref
        .read(notificationsRepositoryProvider)
        .list(filter: ref.read(alertsFilterProvider), page: current.page + 1, limit: pageSize);
    state = AsyncData(Paged(items: [...current.items, ...next.page.items], total: next.page.total, page: next.page.page, limit: pageSize));
  }

  /// Marca como lido na tela imediatamente e confirma na API.
  Future<void> markRead(AppNotification notification) async {
    if (!notification.unread) return;
    final current = state.value;
    if (current != null) {
      final now = DateTime.now().toUtc();
      state = AsyncData(Paged(
        items: [for (final n in current.items) n.id == notification.id ? n.markedRead(now) : n],
        total: current.total,
        page: current.page,
        limit: current.limit,
      ));
    }
    await ref.read(notificationsRepositoryProvider).markRead(notification.id);
    ref.invalidate(unreadAlertsProvider);
  }

  Future<void> markAllRead() async {
    await ref.read(notificationsRepositoryProvider).markAllRead();
    ref.invalidate(unreadAlertsProvider);
    ref.invalidateSelf();
  }
}

final alertsProvider = AsyncNotifierProvider<AlertsNotifier, Paged<AppNotification>>(AlertsNotifier.new);

/// Total de alertas não lidos (badge da aba).
final unreadAlertsProvider = FutureProvider<int>((ref) async {
  ref.watch(pushTickProvider);
  final result = await ref.read(notificationsRepositoryProvider).list(limit: 1);
  return result.unread;
});

/// Último alerta recebido em tempo real, para o aviso dentro do app.
class IncomingAlertNotifier extends Notifier<AppNotification?> {
  @override
  AppNotification? build() => null;

  void push(AppNotification notification) => state = notification;
}

final incomingAlertProvider = NotifierProvider<IncomingAlertNotifier, AppNotification?>(IncomingAlertNotifier.new);
