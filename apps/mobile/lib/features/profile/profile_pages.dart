import 'dart:convert';

import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';
import 'package:share_plus/share_plus.dart';
import 'package:url_launcher/url_launcher.dart';

import '../../core/config/app_config.dart';
import '../../core/network/api_exception.dart';
import '../../core/providers.dart';
import '../../core/theme/app_tokens.g.dart';
import '../../core/utils/formatters.dart';
import '../../core/widgets/buttons.dart';
import '../../core/widgets/common.dart';
import '../../core/widgets/states.dart';
import '../../core/widgets/tones.dart';
import '../../domain/models.dart';
import '../auth/auth_pages.dart';
import '../auth/validators.dart';
import '../auth/server_settings_tile.dart';

final notificationPreferencesProvider =
    FutureProvider.autoDispose<NotificationPreferences>((ref) => ref.read(usersRepositoryProvider).preferences());

// ---------------------------------------------------------------------------
// Perfil
// ---------------------------------------------------------------------------

class ProfilePage extends ConsumerWidget {
  const ProfilePage({super.key});

  Future<void> _editName(BuildContext context, WidgetRef ref, UserProfile user) async {
    final controller = TextEditingController(text: user.name);
    final name = await showDialog<String>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Editar nome'),
        content: TextField(controller: controller, autofocus: true, textCapitalization: TextCapitalization.words, decoration: const InputDecoration(labelText: 'Nome')),
        actions: [
          TextButton(onPressed: () => Navigator.pop(context), child: const Text('Cancelar')),
          FilledButton(
            style: FilledButton.styleFrom(minimumSize: const Size(0, 44)),
            onPressed: () => Navigator.pop(context, controller.text.trim()),
            child: const Text('Salvar'),
          ),
        ],
      ),
    );
    controller.dispose();
    if (name == null || Validators.name(name) != null || !context.mounted) return;
    try {
      final updated = await ref.read(usersRepositoryProvider).updateName(name);
      ref.read(sessionProvider.notifier).updateUser(updated);
      if (context.mounted) showAppSnackbar(context, 'Nome atualizado.', kind: SnackKind.success);
    } on ApiException catch (e) {
      if (context.mounted) showAppSnackbar(context, e.message, kind: SnackKind.error);
    }
  }

  /// LGPD (direito de acesso/portabilidade): baixa os dados e abre o compartilhamento do sistema.
  Future<void> _exportData(BuildContext context, WidgetRef ref) async {
    try {
      final data = await ref.read(usersRepositoryProvider).exportData();
      final bytes = utf8.encode(const JsonEncoder.withIndent('  ').convert(data));
      final day = DateTime.now().toIso8601String().substring(0, 10);
      await SharePlus.instance.share(ShareParams(
        files: [XFile.fromData(bytes, name: 'alertacidade-meus-dados-$day.json', mimeType: 'application/json')],
        fileNameOverrides: ['alertacidade-meus-dados-$day.json'],
        subject: 'Meus dados no AlertaCidade',
      ));
    } on ApiException catch (e) {
      if (context.mounted) showAppSnackbar(context, e.message, kind: SnackKind.error);
    }
  }

  @override
  Widget build(BuildContext context, WidgetRef ref) {
    final user = ref.watch(sessionProvider).value;
    if (user == null) return const SizedBox.shrink();

    Widget tile(IconData icon, String title, {String? subtitle, VoidCallback? onTap, Color? color}) => ListTile(
          leading: Icon(icon, color: color ?? AcColors.textSecondary),
          title: Text(title, style: AcTypeScale.body.copyWith(color: color)),
          subtitle: subtitle == null ? null : Text(subtitle, style: AcTypeScale.caption.copyWith(color: AcColors.textSecondary)),
          trailing: onTap == null ? null : const Icon(Icons.chevron_right),
          onTap: onTap,
        );

    Widget group(String title, List<Widget> children) => Padding(
          padding: const EdgeInsets.only(bottom: AcSpacing.lg),
          child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
            Padding(
              padding: const EdgeInsets.only(left: AcSpacing.xs, bottom: AcSpacing.sm),
              child: Semantics(header: true, child: Text(title.toUpperCase(), style: AcTypeScale.caption.copyWith(color: AcColors.textSecondary, letterSpacing: 0.8))),
            ),
            Card(child: Column(children: ListTile.divideTiles(context: context, tiles: children).toList())),
          ]),
        );

    return Scaffold(
      appBar: AppBar(title: const Text('Perfil')),
      body: ListView(
        padding: const EdgeInsets.all(AcSpacing.lg),
        children: [
          Card(
            child: Padding(
              padding: const EdgeInsets.all(AcSpacing.lg),
              child: Row(children: [
                CircleAvatar(
                  radius: 30,
                  backgroundColor: AcColors.primary,
                  child: Text(user.initials, style: AcTypeScale.title.copyWith(color: AcColors.onPrimary)),
                ),
                const SizedBox(width: AcSpacing.lg),
                Expanded(
                  child: Column(crossAxisAlignment: CrossAxisAlignment.start, children: [
                    Text(user.name, style: AcTypeScale.title),
                    Text(user.email, style: AcTypeScale.body.copyWith(color: AcColors.textSecondary)),
                    const SizedBox(height: AcSpacing.xs),
                    Text(user.role.label, style: AcTypeScale.caption.copyWith(color: AcColors.primary)),
                  ]),
                ),
              ]),
            ),
          ),
          const SizedBox(height: AcSpacing.lg),
          group('Conta', [
            tile(Icons.badge_outlined, 'Editar nome', onTap: () => _editName(context, ref, user)),
            tile(Icons.lock_outline, 'Alterar senha', onTap: () => context.push('/profile/password')),
          ]),
          group('Preferências', [
            tile(Icons.notifications_active_outlined, 'Notificações e raio de monitoramento', onTap: () => context.push('/profile/notifications')),
            tile(Icons.location_on_outlined, 'Permissão de localização',
                subtitle: 'Usada só quando você pede: ver ocorrências próximas e registrar o local.',
                onTap: () => ref.read(locationServiceProvider).openSettings()),
          ]),
          group('Privacidade', [
            tile(Icons.policy_outlined, 'Política de privacidade', onTap: () => showDialog<void>(context: context, builder: (_) => const PrivacyDialog())),
            tile(Icons.download_outlined, 'Exportar meus dados',
                subtitle: 'Cópia (JSON) de tudo que o AlertaCidade guarda sobre você.', onTap: () => _exportData(context, ref)),
            tile(Icons.delete_forever_outlined, 'Excluir minha conta', color: AcColors.error, onTap: () => context.push('/profile/delete')),
          ]),
          group('Ajuda', [
            tile(Icons.phone_in_talk_outlined, 'Defesa Civil — 199', subtitle: 'Em situação de risco, ligue.', onTap: () => launchUrl(Uri.parse('tel:199'))),
            tile(Icons.local_fire_department_outlined, 'Bombeiros — 193', onTap: () => launchUrl(Uri.parse('tel:193'))),
            tile(Icons.info_outline, 'Sobre o AlertaCidade', onTap: () => context.push('/profile/about')),
          ]),
          SecondaryButton(
            label: 'Sair da conta',
            icon: Icons.logout,
            foreground: AcColors.error,
            onPressed: () async {
              final ok = await showConfirmationDialog(context, title: 'Sair da conta?', message: 'Você precisará entrar novamente para registrar ocorrências.', confirmLabel: 'Sair');
              if (ok) await ref.read(sessionProvider.notifier).logout();
            },
          ),
          const SizedBox(height: AcSpacing.lg),
          Center(
            child: Text(
              'Versão ${AppConfig.appVersion}${AppConfig.isProduction ? '' : ' · ambiente de demonstração'}',
              style: AcTypeScale.caption.copyWith(color: AcColors.textSecondary),
            ),
          ),
          // Também aqui (não só no login): quem já está logado quando o endereço do servidor muda
          // não chega à tela de login. A sessão continua válida — o banco é o mesmo.
          const ServerSettingsTile(),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Preferências de notificação
// ---------------------------------------------------------------------------

class NotificationPreferencesPage extends ConsumerStatefulWidget {
  const NotificationPreferencesPage({super.key});

  @override
  ConsumerState<NotificationPreferencesPage> createState() => _NotificationPreferencesPageState();
}

class _NotificationPreferencesPageState extends ConsumerState<NotificationPreferencesPage> {
  NotificationPreferences? _edit;
  bool _saving = false;
  bool _locating = false;

  Future<void> _useCurrentLocation() async {
    setState(() => _locating = true);
    final result = await ref.read(locationServiceProvider).current();
    if (!mounted) return;
    setState(() => _locating = false);
    if (result.ok) {
      setState(() => _edit = _edit!.copyWith(latitude: result.position!.latitude, longitude: result.position!.longitude));
    } else {
      showAppSnackbar(context, result.message, kind: SnackKind.error);
    }
  }

  Future<void> _save() async {
    setState(() => _saving = true);
    try {
      await ref.read(usersRepositoryProvider).savePreferences(_edit!);
      ref.invalidate(notificationPreferencesProvider);
      if (!mounted) return;
      showAppSnackbar(context, 'Preferências salvas.', kind: SnackKind.success);
      context.pop();
    } on ApiException catch (e) {
      if (mounted) showAppSnackbar(context, e.message, kind: SnackKind.error);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    final async = ref.watch(notificationPreferencesProvider);
    if (_edit == null && async.hasValue) _edit = async.value;

    return Scaffold(
      appBar: AppBar(title: const Text('Notificações')),
      body: _edit == null
          ? (async.hasError
              ? ErrorState(error: async.error!, onRetry: () => ref.invalidate(notificationPreferencesProvider))
              : const LoadingSkeleton(items: 3))
          : ListView(padding: const EdgeInsets.all(AcSpacing.lg), children: [
              Card(
                child: SwitchListTile(
                  value: _edit!.pushEnabled,
                  onChanged: (v) => setState(() => _edit = _edit!.copyWith(pushEnabled: v)),
                  title: const Text('Receber alertas'),
                  subtitle: const Text('Notificações sobre ocorrências na sua área de interesse.'),
                ),
              ),
              const SizedBox(height: AcSpacing.md),
              SectionCard(
                title: 'Raio de monitoramento',
                trailing: Text(Formatters.distance(_edit!.radiusMeters), style: AcTypeScale.bodyStrong.copyWith(color: AcColors.primary)),
                child: Slider(
                  value: _edit!.radiusMeters.toDouble(),
                  min: 500,
                  max: 20000,
                  divisions: 39,
                  label: Formatters.distance(_edit!.radiusMeters),
                  onChanged: (v) => setState(() => _edit = _edit!.copyWith(radiusMeters: (v / 500).round() * 500)),
                ),
              ),
              const SizedBox(height: AcSpacing.md),
              SectionCard(
                title: 'Gravidade mínima',
                child: Wrap(spacing: AcSpacing.sm, runSpacing: AcSpacing.sm, children: [
                  for (final s in Severity.values)
                    AcFilterChip(
                      label: s.label,
                      icon: Icons.circle,
                      color: s.palette.marker,
                      selected: _edit!.minSeverity == s,
                      onSelected: (_) => setState(() => _edit = _edit!.copyWith(minSeverity: s)),
                    ),
                ]),
              ),
              const SizedBox(height: AcSpacing.md),
              SectionCard(
                title: 'Área de interesse',
                child: Column(crossAxisAlignment: CrossAxisAlignment.stretch, children: [
                  Text(
                    _edit!.hasArea
                        ? 'Centro definido (${_edit!.latitude!.toStringAsFixed(4)}, ${_edit!.longitude!.toStringAsFixed(4)}).'
                        : 'Nenhuma área definida.',
                    style: AcTypeScale.body,
                  ),
                  const SizedBox(height: AcSpacing.xs),
                  Text(
                    'Guardamos apenas o ponto que você escolher — sua localização não é monitorada continuamente.',
                    style: AcTypeScale.caption.copyWith(color: AcColors.textSecondary),
                  ),
                  const SizedBox(height: AcSpacing.md),
                  SecondaryButton(
                    label: _locating ? 'Localizando…' : 'Usar minha localização atual',
                    icon: Icons.my_location,
                    onPressed: _locating ? null : _useCurrentLocation,
                  ),
                  if (_edit!.hasArea)
                    TextButton(onPressed: () => setState(() => _edit = _edit!.copyWith(clearArea: true)), child: const Text('Remover área')),
                ]),
              ),
              const SizedBox(height: AcSpacing.xl),
              PrimaryButton(label: 'Salvar preferências', loading: _saving, onPressed: _save),
            ]),
    );
  }
}

// ---------------------------------------------------------------------------
// Alterar senha
// ---------------------------------------------------------------------------

class ChangePasswordPage extends ConsumerStatefulWidget {
  const ChangePasswordPage({super.key});

  @override
  ConsumerState<ChangePasswordPage> createState() => _ChangePasswordPageState();
}

class _ChangePasswordPageState extends ConsumerState<ChangePasswordPage> {
  final _form = GlobalKey<FormState>();
  final _current = TextEditingController();
  final _next = TextEditingController();
  bool _saving = false;
  ApiException? _error;

  @override
  void dispose() {
    _current.dispose();
    _next.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    if (_saving || !_form.currentState!.validate()) return;
    setState(() {
      _saving = true;
      _error = null;
    });
    try {
      await ref.read(usersRepositoryProvider).changePassword(currentPassword: _current.text, newPassword: _next.text);
      if (!mounted) return;
      // A API encerra todas as sessões ao trocar a senha: é preciso entrar de novo.
      showAppSnackbar(context, 'Senha alterada. Entre novamente com a nova senha.', kind: SnackKind.success);
      await ref.read(sessionProvider.notifier).logout();
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _saving = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Alterar senha')),
      body: Form(
        key: _form,
        child: ListView(padding: const EdgeInsets.all(AcSpacing.lg), children: [
          PasswordField(
            controller: _current,
            label: 'Senha atual',
            validator: (v) => (v ?? '').isEmpty ? 'Informe a senha atual' : null,
            errorText: _error?.kind == ApiErrorKind.unauthorized ? _error!.message : null,
          ),
          const SizedBox(height: AcSpacing.lg),
          PasswordField(
            controller: _next,
            label: 'Nova senha',
            validator: Validators.password,
            helperText: 'Mínimo de 8 caracteres, com maiúscula, minúscula e número.',
            errorText: _error?.fieldError('newPassword'),
          ),
          const SizedBox(height: AcSpacing.xl),
          PrimaryButton(label: 'Alterar senha', loading: _saving, onPressed: _submit),
        ]),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Excluir conta (LGPD)
// ---------------------------------------------------------------------------

class DeleteAccountPage extends ConsumerStatefulWidget {
  const DeleteAccountPage({super.key});

  @override
  ConsumerState<DeleteAccountPage> createState() => _DeleteAccountPageState();
}

class _DeleteAccountPageState extends ConsumerState<DeleteAccountPage> {
  final _password = TextEditingController();
  bool _deleting = false;
  String? _error;

  @override
  void dispose() {
    _password.dispose();
    super.dispose();
  }

  Future<void> _delete() async {
    if (_password.text.isEmpty) return setState(() => _error = 'Informe sua senha');
    final ok = await showConfirmationDialog(
      context,
      title: 'Excluir conta definitivamente?',
      message: 'Seus dados pessoais serão apagados. Seus relatos continuarão públicos, sem identificação.',
      confirmLabel: 'Excluir',
      destructive: true,
    );
    if (!ok) return;
    setState(() {
      _deleting = true;
      _error = null;
    });
    try {
      await ref.read(usersRepositoryProvider).deleteAccount(_password.text);
      await ref.read(sessionProvider.notifier).logout();
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _deleting = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Excluir conta')),
      body: ListView(padding: const EdgeInsets.all(AcSpacing.lg), children: [
        const Icon(Icons.warning_amber_rounded, size: 48, color: AcColors.error),
        const SizedBox(height: AcSpacing.md),
        Text('O que acontece ao excluir', style: AcTypeScale.title),
        const SizedBox(height: AcSpacing.sm),
        Text(
          '• Nome, e-mail, preferências, alertas e itens salvos são apagados.\n'
          '• Suas ocorrências permanecem visíveis, sem o seu nome, por interesse público.\n'
          '• Esta ação não pode ser desfeita.',
          style: AcTypeScale.body.copyWith(height: 1.6),
        ),
        const SizedBox(height: AcSpacing.xl),
        PasswordField(controller: _password, label: 'Confirme sua senha', errorText: _error),
        const SizedBox(height: AcSpacing.xl),
        FilledButton(
          style: FilledButton.styleFrom(backgroundColor: AcColors.error),
          onPressed: _deleting ? null : _delete,
          child: _deleting ? const SizedBox(width: 22, height: 22, child: CircularProgressIndicator(strokeWidth: 2.5, color: Colors.white)) : const Text('Excluir minha conta'),
        ),
      ]),
    );
  }
}

// ---------------------------------------------------------------------------
// Sobre
// ---------------------------------------------------------------------------

class AboutPage extends StatelessWidget {
  const AboutPage({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(title: const Text('Sobre')),
      body: ListView(padding: const EdgeInsets.all(AcSpacing.xl), children: [
        const AppLogo(size: 44),
        const SizedBox(height: AcSpacing.lg),
        Text('Plataforma Inteligente e Colaborativa de Monitoramento de Alagamentos Urbanos.', style: AcTypeScale.subtitle),
        const SizedBox(height: AcSpacing.md),
        Text(
          'Projeto acadêmico desenvolvido para a disciplina de Sistemas Distribuídos (APS) do curso de Ciência da Computação da UNIP.\n\n'
          'As ocorrências são relatos enviados por cidadãos e moderados pela administração da plataforma. '
          'O AlertaCidade não é um serviço oficial de emergência e não possui vínculo com órgãos públicos.\n\n'
          'Em situação de risco, ligue 199 (Defesa Civil) ou 193 (Bombeiros).',
          style: AcTypeScale.body.copyWith(height: 1.5),
        ),
        const SizedBox(height: AcSpacing.xl),
        Text('Versão ${AppConfig.appVersion} (${AppConfig.appEnv})', style: AcTypeScale.caption.copyWith(color: AcColors.textSecondary)),
        Text('Mapas © colaboradores do OpenStreetMap', style: AcTypeScale.caption.copyWith(color: AcColors.textSecondary)),
        Text('Fonte Inter — SIL Open Font License 1.1', style: AcTypeScale.caption.copyWith(color: AcColors.textSecondary)),
      ]),
    );
  }
}
