import 'package:material_ui/material_ui.dart';

import '../theme/app_tokens.g.dart';

/// Botão principal. Em `loading`, mostra progresso e fica desabilitado (impede envio duplicado).
class PrimaryButton extends StatelessWidget {
  const PrimaryButton({super.key, required this.label, required this.onPressed, this.loading = false, this.icon});

  final String label;
  final VoidCallback? onPressed;
  final bool loading;
  final IconData? icon;

  @override
  Widget build(BuildContext context) {
    return FilledButton(
      onPressed: loading ? null : onPressed,
      child: AnimatedSwitcher(
        duration: AcMotion.fast,
        child: loading
            ? const SizedBox(
                key: ValueKey('loading'),
                width: 22,
                height: 22,
                child: CircularProgressIndicator(strokeWidth: 2.5, color: AcColors.onPrimary),
              )
            : Row(
                key: const ValueKey('label'),
                mainAxisSize: MainAxisSize.min,
                children: [
                  if (icon != null) ...[Icon(icon, size: 20), const SizedBox(width: AcSpacing.sm)],
                  Flexible(child: Text(label, overflow: TextOverflow.ellipsis)),
                ],
              ),
      ),
    );
  }
}

class SecondaryButton extends StatelessWidget {
  const SecondaryButton({super.key, required this.label, required this.onPressed, this.icon, this.foreground});

  final String label;
  final VoidCallback? onPressed;
  final IconData? icon;
  final Color? foreground;

  @override
  Widget build(BuildContext context) {
    return OutlinedButton(
      onPressed: onPressed,
      style: foreground == null ? null : OutlinedButton.styleFrom(foregroundColor: foreground),
      child: Row(
        mainAxisSize: MainAxisSize.min,
        children: [
          if (icon != null) ...[Icon(icon, size: 20), const SizedBox(width: AcSpacing.sm)],
          Flexible(child: Text(label, overflow: TextOverflow.ellipsis)),
        ],
      ),
    );
  }
}

/// Ação complementar compacta em formato de pílula (ex.: Salvar, Compartilhar).
/// Visual de 40 px, mas a área de toque continua com 48 × 48 (acessibilidade).
class PillButton extends StatelessWidget {
  const PillButton({super.key, required this.label, required this.icon, required this.onPressed, this.selected = false, this.semanticLabel});

  final String label;
  final IconData icon;
  final VoidCallback? onPressed;
  final bool selected;
  final String? semanticLabel;

  @override
  Widget build(BuildContext context) {
    final fg = selected ? AcColors.primary : AcColors.textPrimary;
    return Semantics(
      button: true,
      selected: selected,
      label: semanticLabel ?? label,
      excludeSemantics: true,
      child: OutlinedButton.icon(
        onPressed: onPressed,
        icon: Icon(icon, size: 18, color: fg),
        label: Text(label, style: AcTypeScale.label.copyWith(color: fg, fontWeight: FontWeight.w600)),
        style: OutlinedButton.styleFrom(
          minimumSize: const Size(0, 40),
          tapTargetSize: MaterialTapTargetSize.padded,
          padding: const EdgeInsets.symmetric(horizontal: AcSpacing.lg),
          shape: const StadiumBorder(),
          backgroundColor: selected ? AcColors.primaryLight : AcColors.surface,
          side: BorderSide(color: selected ? AcColors.primary : AcColors.border),
        ),
      ),
    );
  }
}
