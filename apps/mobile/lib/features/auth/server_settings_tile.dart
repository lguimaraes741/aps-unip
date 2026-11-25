import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:material_ui/material_ui.dart';

import '../../core/config/app_config.dart';
import '../../core/config/server_settings.dart';
import '../../core/providers.dart';
import '../../core/theme/app_tokens.g.dart';
import '../../core/widgets/common.dart';

/// Teste do endereço (substituível nos testes).
final serverCheckProvider = Provider<Future<ServerCheck> Function(String baseUrl)>((ref) => checkServer);

/// Linha discreta na tela de login: mostra o servidor em uso e permite trocá-lo
/// (ex.: o túnel público mudou de endereço) sem gerar outro APK.
class ServerSettingsTile extends ConsumerStatefulWidget {
  const ServerSettingsTile({super.key});

  @override
  ConsumerState<ServerSettingsTile> createState() => _ServerSettingsTileState();
}

class _ServerSettingsTileState extends ConsumerState<ServerSettingsTile> {
  Future<void> _open() async {
    final changed = await showDialog<String>(context: context, builder: (_) => const ServerSettingsDialog());
    if (changed != null && mounted) {
      setState(() {});
      showAppSnackbar(context, changed, kind: SnackKind.success);
    }
  }

  @override
  Widget build(BuildContext context) {
    final host = Uri.tryParse(AppConfig.apiBaseUrl)?.host ?? AppConfig.apiBaseUrl;
    return Center(
      child: TextButton.icon(
        key: const ValueKey('server-settings'),
        onPressed: _open,
        icon: const Icon(Icons.dns_outlined, size: 16, color: AcColors.textSecondary),
        label: Text(
          'Servidor: $host${AppConfig.hasOverride ? ' (personalizado)' : ''}',
          style: AcTypeScale.caption.copyWith(color: AcColors.textSecondary),
          overflow: TextOverflow.ellipsis,
        ),
      ),
    );
  }
}

class ServerSettingsDialog extends ConsumerStatefulWidget {
  const ServerSettingsDialog({super.key});

  @override
  ConsumerState<ServerSettingsDialog> createState() => _ServerSettingsDialogState();
}

class _ServerSettingsDialogState extends ConsumerState<ServerSettingsDialog> {
  late final _controller = TextEditingController(text: AppConfig.apiBaseUrl);
  String? _error;
  bool _busy = false;

  @override
  void dispose() {
    _controller.dispose();
    super.dispose();
  }

  /// Aplica o endereço atual ao cliente HTTP e ao canal de tempo real.
  void _apply() {
    ref.read(apiClientProvider).updateBaseUrl();
    ref.invalidate(realtimeTransportProvider);
  }

  Future<void> _save() async {
    final url = normalizeServerUrl(_controller.text);
    if (url == null) {
      setState(() => _error = 'Endereço inválido. Exemplo: https://exemplo.trycloudflare.com');
      return;
    }
    setState(() {
      _busy = true;
      _error = null;
    });
    final result = await ref.read(serverCheckProvider)(url);
    if (!mounted) return;
    if (result != ServerCheck.ok) {
      setState(() {
        _busy = false;
        _error = switch (result) {
          ServerCheck.unreachable => 'O servidor não respondeu. Confira o endereço e se o sistema está no ar'
              '${url.startsWith('http://') ? ' (esta versão do app só aceita endereços https://)' : ''}.',
          _ => 'Esse endereço respondeu, mas não é um servidor do AlertaCidade.',
        };
      });
      return;
    }
    await ServerSettings.save(url);
    _apply();
    if (mounted) Navigator.of(context).pop('Servidor atualizado.');
  }

  Future<void> _reset() async {
    await ServerSettings.reset();
    _apply();
    if (mounted) Navigator.of(context).pop('Voltou ao servidor padrão do app.');
  }

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Servidor'),
      content: Column(mainAxisSize: MainAxisSize.min, crossAxisAlignment: CrossAxisAlignment.start, children: [
        Text(
          'Endereço do sistema AlertaCidade. Troque só se o grupo informou um endereço novo.',
          style: AcTypeScale.label.copyWith(color: AcColors.textSecondary),
        ),
        const SizedBox(height: AcSpacing.md),
        TextField(
          key: const ValueKey('server-url'),
          controller: _controller,
          enabled: !_busy,
          keyboardType: TextInputType.url,
          autocorrect: false,
          decoration: InputDecoration(labelText: 'Endereço', hintText: 'https://…', errorText: _error, errorMaxLines: 4),
          onSubmitted: (_) => _save(),
        ),
        if (AppConfig.hasOverride) ...[
          const SizedBox(height: AcSpacing.xs),
          Text('Padrão do app: ${AppConfig.builtInBaseUrl}', style: AcTypeScale.caption.copyWith(color: AcColors.textSecondary)),
        ],
      ]),
      actions: [
        if (AppConfig.hasOverride) TextButton(onPressed: _busy ? null : _reset, child: const Text('Usar padrão')),
        TextButton(onPressed: _busy ? null : () => Navigator.of(context).pop(), child: const Text('Cancelar')),
        FilledButton(
          onPressed: _busy ? null : _save,
          child: _busy
              ? const SizedBox(width: 18, height: 18, child: CircularProgressIndicator(strokeWidth: 2))
              : const Text('Testar e salvar'),
        ),
      ],
    );
  }
}
