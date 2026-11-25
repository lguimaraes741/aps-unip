import 'package:material_ui/material_ui.dart';

import '../network/api_exception.dart';
import '../theme/app_tokens.g.dart';

class EmptyState extends StatelessWidget {
  const EmptyState({super.key, required this.icon, required this.title, this.message, this.action});

  final IconData icon;
  final String title;
  final String? message;
  final Widget? action;

  @override
  Widget build(BuildContext context) {
    return Center(
      child: Padding(
        padding: const EdgeInsets.all(AcSpacing.xxl),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            Container(
              padding: const EdgeInsets.all(AcSpacing.lg),
              decoration: const BoxDecoration(color: AcColors.primaryLight, shape: BoxShape.circle),
              child: Icon(icon, size: 32, color: AcColors.primary),
            ),
            const SizedBox(height: AcSpacing.lg),
            Text(title, style: AcTypeScale.subtitle, textAlign: TextAlign.center),
            if (message != null) ...[
              const SizedBox(height: AcSpacing.sm),
              Text(message!, style: AcTypeScale.body.copyWith(color: AcColors.textSecondary), textAlign: TextAlign.center),
            ],
            if (action != null) ...[const SizedBox(height: AcSpacing.xl), action!],
          ],
        ),
      ),
    );
  }
}

/// Erro com mensagem contextual e ação de nova tentativa.
class ErrorState extends StatelessWidget {
  const ErrorState({super.key, required this.error, required this.onRetry});

  final Object error;
  final VoidCallback onRetry;

  @override
  Widget build(BuildContext context) {
    final api = error is ApiException ? error as ApiException : null;
    final offline = api?.isConnectivity ?? false;
    return EmptyState(
      icon: offline ? Icons.wifi_off_rounded : Icons.error_outline_rounded,
      title: offline ? 'Sem conexão' : 'Algo deu errado',
      message: api?.message ?? 'Não foi possível carregar as informações.',
      action: OutlinedButton.icon(onPressed: onRetry, icon: const Icon(Icons.refresh), label: const Text('Tentar novamente')),
    );
  }
}

/// Placeholder animado exibido enquanto os dados carregam.
class LoadingSkeleton extends StatefulWidget {
  const LoadingSkeleton({super.key, this.items = 4, this.itemHeight = 96});

  final int items;
  final double itemHeight;

  @override
  State<LoadingSkeleton> createState() => _LoadingSkeletonState();
}

class _LoadingSkeletonState extends State<LoadingSkeleton> with SingleTickerProviderStateMixin {
  late final AnimationController _c =
      AnimationController(vsync: this, duration: const Duration(milliseconds: 900))..repeat(reverse: true);

  @override
  void dispose() {
    _c.dispose();
    super.dispose();
  }

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: 'Carregando',
      child: FadeTransition(
        opacity: Tween(begin: 0.45, end: 1.0).animate(_c),
        child: ListView.separated(
          physics: const NeverScrollableScrollPhysics(),
          shrinkWrap: true,
          padding: const EdgeInsets.all(AcSpacing.lg),
          itemCount: widget.items,
          separatorBuilder: (_, _) => const SizedBox(height: AcSpacing.md),
          itemBuilder: (_, _) => Container(
            height: widget.itemHeight,
            decoration: BoxDecoration(color: AcColors.surfaceMuted, borderRadius: BorderRadius.circular(AcRadius.md)),
          ),
        ),
      ),
    );
  }
}

/// Barra fixa exibida quando o aparelho está sem rede.
class OfflineBanner extends StatelessWidget {
  const OfflineBanner({super.key});

  @override
  Widget build(BuildContext context) {
    return Semantics(
      liveRegion: true,
      child: Material(
        color: AcColors.textPrimary,
        child: SafeArea(
          bottom: false,
          child: Padding(
            padding: const EdgeInsets.symmetric(horizontal: AcSpacing.lg, vertical: AcSpacing.sm),
            child: Row(
              children: [
                const Icon(Icons.wifi_off_rounded, color: Colors.white, size: 18),
                const SizedBox(width: AcSpacing.sm),
                Expanded(
                  child: Text(
                    'Sem conexão. Os dados serão atualizados quando a internet voltar.',
                    style: AcTypeScale.caption.copyWith(color: Colors.white),
                  ),
                ),
              ],
            ),
          ),
        ),
      ),
    );
  }
}
