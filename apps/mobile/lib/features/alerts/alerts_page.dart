import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../../core/theme/app_tokens.g.dart';
import '../../core/utils/formatters.dart';
import '../../core/widgets/badges.dart';
import '../../core/widgets/common.dart';
import '../../core/widgets/states.dart';
import '../../domain/models.dart';
import '../profile/profile_pages.dart';
import '../news/news_feed_state.dart';
import 'alerts_state.dart';

/// Central de alertas: caixa de entrada alimentada pelo worker de notificações.
/// Novos alertas chegam em tempo real (Socket.IO) e também como push no aparelho.
class AlertsPage extends ConsumerWidget {
  const AlertsPage({super.key});

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final filter = ref.watch(alertsFilterProvider);
    final alerts = ref.watch(alertsProvider);
    final unread = ref.watch(unreadAlertsProvider).value ?? 0;

    return Scaffold(
      appBar: AppBar(
        title: const Text('Alertas'),
        actions: [
          if (unread > 0)
            TextButton(
              onPressed: () => _run(context, () => ref.read(alertsProvider.notifier).markAllRead()),
              child: const Text('Marcar todos como lidos'),
            ),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: () async {
          ref.invalidate(unreadAlertsProvider);
          return ref.refresh(alertsProvider.future);
        },
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.all(AcSpacing.lg),
          children: [
            SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: Row(children: [
                for (final f in NotificationFilter.values)
                  Padding(
                    padding: const EdgeInsets.only(right: AcSpacing.sm),
                    child: AcFilterChip(
                      label: f == NotificationFilter.unread && unread > 0 ? '${f.label} ($unread)' : f.label,
                      selected: filter == f,
                      onSelected: (_) => ref.read(alertsFilterProvider.notifier).set(f),
                    ),
                  ),
              ]),
            ),
            const SizedBox(height: AcSpacing.lg),
            const _NewsEntry(),
            const SizedBox(height: AcSpacing.md),
            const _PreferencesBanner(),
            const SizedBox(height: AcSpacing.lg),
            ...alerts.when(
              skipLoadingOnRefresh: true,
              data: (page) => page.items.isEmpty
                  ? [_EmptyAlerts(filter: filter)]
                  : [
                      for (final n in page.items) _AlertTile(notification: n),
                      if (page.hasMore)
                        Padding(
                          padding: const EdgeInsets.only(top: AcSpacing.md),
                          child: OutlinedButton(
                            onPressed: () => _run(context, () => ref.read(alertsProvider.notifier).loadMore()),
                            child: const Text('Carregar mais'),
                          ),
                        ),
                    ],
              loading: () => const [LoadingSkeleton(items: 4, itemHeight: 88)],
              error: (e, _) => [ErrorState(error: e, onRetry: () => ref.invalidate(alertsProvider))],
            ),
          ],
        ),
      ),
    );
  }
}

Future<void> _run(BuildContext context, Future<void> Function() action) async {
  try {
    await action();
  } catch (e) {
    if (context.mounted) showAppSnackbar(context, 'Não foi possível concluir. Verifique a conexão e tente novamente.');
  }
}

/// Entrada da tela "Notícias e monitoramento" (wireframe 7.9: pela central, sem 5ª aba).
class _NewsEntry extends ConsumerWidget {
  const _NewsEntry();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final count = ref.watch(activeNewsCountProvider).value;
    final subtitle = switch (count) {
      null => 'Alertas identificados em notícias e comunicados',
      0 => 'Nenhum alerta de notícia em vigor agora',
      1 => '1 alerta em vigor nas cidades monitoradas',
      _ => '$count alertas em vigor nas cidades monitoradas',
    };
    return Material(
      color: AcColors.surface,
      borderRadius: BorderRadius.circular(AcRadius.md),
      child: InkWell(
        borderRadius: BorderRadius.circular(AcRadius.md),
        onTap: () => context.push('/news'),
        child: Container(
          padding: const EdgeInsets.all(AcSpacing.lg),
          decoration: BoxDecoration(borderRadius: BorderRadius.circular(AcRadius.md), border: Border.all(color: AcColors.border)),
          child: Row(children: [
            const Icon(Icons.newspaper, color: AcColors.primary),
            const SizedBox(width: AcSpacing.md),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text('Notícias e monitoramento', style: AcTypeScale.bodyStrong),
                Text(subtitle, style: AcTypeScale.caption.copyWith(color: AcColors.textSecondary)),
              ]),
            ),
            const Icon(Icons.chevron_right, color: AcColors.textSecondary),
          ]),
        ),
      ),
    );
  }
}

class _PreferencesBanner extends ConsumerWidget {
  const _PreferencesBanner();

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final prefs = ref.watch(notificationPreferencesProvider).value;
    final noArea = prefs != null && (prefs.latitude == null || prefs.longitude == null);
    return Material(
      color: AcColors.primaryLight,
      borderRadius: BorderRadius.circular(AcRadius.md),
      child: InkWell(
        borderRadius: BorderRadius.circular(AcRadius.md),
        onTap: () => context.push('/profile/notifications'),
        child: Padding(
          padding: const EdgeInsets.all(AcSpacing.lg),
          child: Row(children: [
            const Icon(Icons.radar, color: AcColors.primary),
            const SizedBox(width: AcSpacing.md),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text('Raio de alertas personalizado', style: AcTypeScale.bodyStrong.copyWith(color: AcColors.primaryDark)),
                Text(
                  prefs == null
                      ? 'Defina a área e a gravidade mínima dos alertas.'
                      : noArea
                          ? 'Defina sua área de interesse para receber alertas de ocorrências próximas.'
                          : '${prefs.pushEnabled ? 'Ativo' : 'Desativado'} · ${Formatters.distance(prefs.radiusMeters)} · a partir de ${prefs.minSeverity.label.toLowerCase()}',
                  style: AcTypeScale.caption.copyWith(color: AcColors.primaryDark),
                ),
              ]),
            ),
            const Icon(Icons.chevron_right, color: AcColors.primary),
          ]),
        ),
      ),
    );
  }
}

class _AlertTile extends ConsumerWidget {
  const _AlertTile({required this.notification});

  final AppNotification notification;

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final n = notification;
    final occurrence = n.occurrence;
    final icon = n.kind == NotificationKind.newsReviewUrgent
        ? Icons.gavel_outlined
        : n.kind.isNews
        ? Icons.newspaper_outlined
        : n.kind == NotificationKind.nearby
            ? Icons.water_drop_outlined
            : Icons.fact_check_outlined;
    return Card(
      margin: const EdgeInsets.only(bottom: AcSpacing.md),
      color: n.unread ? AcColors.surface : AcColors.background,
      child: InkWell(
        borderRadius: BorderRadius.circular(AcRadius.md),
        onTap: () async {
          await _run(context, () => ref.read(alertsProvider.notifier).markRead(n));
          if (!context.mounted) return;
          if (n.kind == NotificationKind.newsReviewUrgent) {
            // A notícia pode nem estar publicada (a tela pública daria "não encontrado"): a revisão é no painel.
            showAppSnackbar(context, 'Revise esta notícia no painel de moderação (computador).');
          } else if (n.newsEventId != null) {
            context.push('/news/${n.newsEventId}');
          } else if (n.occurrenceId != null && occurrence != null) {
            context.push('/occurrences/${n.occurrenceId}');
          } else if (n.occurrenceId != null) {
            showAppSnackbar(context, 'Esta ocorrência foi removida pelo autor.');
          }
        },
        child: Padding(
          padding: const EdgeInsets.all(AcSpacing.lg),
          child: Row(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Icon(icon, color: n.unread ? AcColors.primary : AcColors.textSecondary),
            const SizedBox(width: AcSpacing.md),
            Expanded(
              child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                Text(
                  n.title,
                  style: (n.unread ? AcTypeScale.bodyStrong : AcTypeScale.body).copyWith(color: AcColors.textPrimary),
                ),
                const SizedBox(height: AcSpacing.xs),
                Text(n.body, style: AcTypeScale.caption.copyWith(color: AcColors.textSecondary)),
                const SizedBox(height: AcSpacing.sm),
                Wrap(spacing: AcSpacing.sm, runSpacing: AcSpacing.xs, crossAxisAlignment: WrapCrossAlignment.center, children: [
                  if (occurrence != null) ...[SeverityBadge(occurrence.severity), StatusBadge(occurrence.status)],
                  if (occurrence == null && n.occurrenceId != null)
                    Text('Ocorrência removida', style: AcTypeScale.caption.copyWith(color: AcColors.textSecondary)),
                  Text(Formatters.relative(n.createdAt), style: AcTypeScale.caption.copyWith(color: AcColors.textSecondary)),
                ]),
              ]),
            ),
            if (n.unread)
              Semantics(
                label: 'Não lido',
                child: Container(
                  width: 10,
                  height: 10,
                  margin: const EdgeInsets.only(top: 6, left: AcSpacing.sm),
                  decoration: const BoxDecoration(color: AcColors.primary, shape: BoxShape.circle),
                ),
              ),
          ]),
        ),
      ),
    );
  }
}

class _EmptyAlerts extends StatelessWidget {
  const _EmptyAlerts({required this.filter});

  final NotificationFilter filter;

  @override
  Widget build(BuildContext context) {
    final (title, message) = switch (filter) {
      NotificationFilter.unread => ('Tudo lido', 'Você não tem alertas pendentes de leitura.'),
      NotificationFilter.critical => ('Nenhum alerta crítico', 'Alertas de ocorrências de gravidade crítica aparecem aqui.'),
      NotificationFilter.nearby => ('Nenhum alerta próximo', 'Ocorrências dentro da sua área de interesse aparecem aqui.'),
      NotificationFilter.resolved => ('Nenhum alerta resolvido', 'Alertas cujas ocorrências já foram resolvidas aparecem aqui.'),
      NotificationFilter.all => (
          'Nenhum alerta por enquanto',
          'Quando houver ocorrências na sua área de interesse, elas aparecerão aqui e como notificação no aparelho.',
        ),
    };
    return Padding(
      padding: const EdgeInsets.only(top: AcSpacing.xl),
      child: EmptyState(icon: Icons.notifications_none_rounded, title: title, message: message),
    );
  }
}
