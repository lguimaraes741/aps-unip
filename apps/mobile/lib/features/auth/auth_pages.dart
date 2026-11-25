import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:go_router/go_router.dart';
import 'package:material_ui/material_ui.dart';

import '../../core/network/api_exception.dart';
import '../../core/providers.dart';
import '../../core/theme/app_tokens.g.dart';
import '../../core/widgets/buttons.dart';
import '../../core/widgets/common.dart';
import 'validators.dart';

// ---------------------------------------------------------------------------
// Splash e boas-vindas
// ---------------------------------------------------------------------------

class SplashPage extends StatelessWidget {
  const SplashPage({super.key});

  @override
  Widget build(BuildContext context) {
    return const Scaffold(
      backgroundColor: AcColors.primary,
      body: Center(
        child: Column(
          mainAxisSize: MainAxisSize.min,
          children: [
            AppLogo(size: 56, onDark: true),
            SizedBox(height: AcSpacing.xxl),
            SizedBox(
              width: 28,
              height: 28,
              child: CircularProgressIndicator(color: AcColors.onPrimary, strokeWidth: 3),
            ),
          ],
        ),
      ),
    );
  }
}

class WelcomePage extends StatelessWidget {
  const WelcomePage({super.key});

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: AcColors.primary,
      body: SafeArea(
        child: Padding(
          padding: const EdgeInsets.all(AcSpacing.xl),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.stretch,
            children: [
              const SizedBox(height: AcSpacing.xxl),
              const Align(alignment: Alignment.centerLeft, child: AppLogo(size: 44, onDark: true)),
              const Spacer(),
              Text(
                'Sua cidade informada.\nSua segurança em primeiro lugar.',
                style: AcTypeScale.headline.copyWith(color: AcColors.onPrimary, fontSize: 28, height: 1.25),
              ),
              const SizedBox(height: AcSpacing.lg),
              Text(
                'Registre, confirme e acompanhe alagamentos na sua região junto com outros cidadãos.',
                style: AcTypeScale.body.copyWith(color: AcColors.onPrimary.withValues(alpha: 0.9)),
              ),
              const SizedBox(height: AcSpacing.xl),
              const _EmergencyNotice(),
              const SizedBox(height: AcSpacing.xl),
              FilledButton(
                style: FilledButton.styleFrom(backgroundColor: AcColors.onPrimary, foregroundColor: AcColors.primary),
                onPressed: () => context.push('/register'),
                child: const Text('Criar conta'),
              ),
              const SizedBox(height: AcSpacing.md),
              OutlinedButton(
                style: OutlinedButton.styleFrom(
                  foregroundColor: AcColors.onPrimary,
                  side: const BorderSide(color: AcColors.onPrimary),
                ),
                onPressed: () => context.push('/login'),
                child: const Text('Já tenho conta'),
              ),
              const SizedBox(height: AcSpacing.lg),
            ],
          ),
        ),
      ),
    );
  }
}

/// O AlertaCidade não é serviço oficial de emergência (especificação, seção 12).
class _EmergencyNotice extends StatelessWidget {
  const _EmergencyNotice();

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.all(AcSpacing.md),
      decoration: BoxDecoration(color: AcColors.primaryDark, borderRadius: BorderRadius.circular(AcRadius.md)),
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          const Icon(Icons.info_outline, color: AcColors.onPrimary, size: 20),
          const SizedBox(width: AcSpacing.sm),
          Expanded(
            child: Text(
              'O AlertaCidade reúne relatos de cidadãos e não é um serviço oficial de emergência. '
              'Em situação de risco, ligue 199 (Defesa Civil) ou 193 (Bombeiros).',
              style: AcTypeScale.caption.copyWith(color: AcColors.onPrimary, height: 1.4),
            ),
          ),
        ],
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Estrutura comum dos formulários de autenticação
// ---------------------------------------------------------------------------

class _AuthScaffold extends StatelessWidget {
  const _AuthScaffold({required this.title, required this.subtitle, required this.children});

  final String title;
  final String subtitle;
  final List<Widget> children;

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(backgroundColor: AcColors.background),
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.fromLTRB(AcSpacing.xl, 0, AcSpacing.xl, AcSpacing.xl),
          children: [
            const Align(alignment: Alignment.centerLeft, child: AppLogo(size: 36, showName: false)),
            const SizedBox(height: AcSpacing.lg),
            Semantics(header: true, child: Text(title, style: AcTypeScale.headline)),
            const SizedBox(height: AcSpacing.xs),
            Text(subtitle, style: AcTypeScale.body.copyWith(color: AcColors.textSecondary)),
            const SizedBox(height: AcSpacing.xl),
            ...children,
          ],
        ),
      ),
    );
  }
}

class _FormError extends StatelessWidget {
  const _FormError(this.message);

  final String? message;

  @override
  Widget build(BuildContext context) {
    if (message == null) return const SizedBox.shrink();
    return Semantics(
      liveRegion: true,
      child: Container(
        margin: const EdgeInsets.only(bottom: AcSpacing.lg),
        padding: const EdgeInsets.all(AcSpacing.md),
        decoration: BoxDecoration(
          color: AcColors.error.withValues(alpha: 0.08),
          borderRadius: BorderRadius.circular(AcRadius.sm),
          border: Border.all(color: AcColors.error.withValues(alpha: 0.3)),
        ),
        child: Row(
          children: [
            const Icon(Icons.error_outline, color: AcColors.error, size: 20),
            const SizedBox(width: AcSpacing.sm),
            Expanded(
              child: Text(message!, style: AcTypeScale.body.copyWith(color: AcColors.error)),
            ),
          ],
        ),
      ),
    );
  }
}

class PasswordField extends StatefulWidget {
  const PasswordField({
    super.key,
    required this.controller,
    required this.label,
    this.validator,
    this.errorText,
    this.textInputAction,
    this.onSubmitted,
    this.helperText,
  });

  final TextEditingController controller;
  final String label;
  final String? Function(String?)? validator;
  final String? errorText;
  final String? helperText;
  final TextInputAction? textInputAction;
  final ValueChanged<String>? onSubmitted;

  @override
  State<PasswordField> createState() => _PasswordFieldState();
}

class _PasswordFieldState extends State<PasswordField> {
  bool _obscure = true;

  @override
  Widget build(BuildContext context) {
    return TextFormField(
      controller: widget.controller,
      obscureText: _obscure,
      validator: widget.validator,
      textInputAction: widget.textInputAction,
      onFieldSubmitted: widget.onSubmitted,
      autofillHints: const [AutofillHints.password],
      decoration: InputDecoration(
        labelText: widget.label,
        errorText: widget.errorText,
        helperText: widget.helperText,
        helperMaxLines: 2,
        prefixIcon: const Icon(Icons.lock_outline),
        suffixIcon: IconButton(
          tooltip: _obscure ? 'Mostrar senha' : 'Ocultar senha',
          icon: Icon(_obscure ? Icons.visibility_outlined : Icons.visibility_off_outlined),
          onPressed: () => setState(() => _obscure = !_obscure),
        ),
      ),
    );
  }
}

// ---------------------------------------------------------------------------
// Login
// ---------------------------------------------------------------------------

class LoginPage extends ConsumerStatefulWidget {
  const LoginPage({super.key});

  @override
  ConsumerState<LoginPage> createState() => _LoginPageState();
}

class _LoginPageState extends ConsumerState<LoginPage> {
  final _form = GlobalKey<FormState>();
  final _email = TextEditingController();
  final _password = TextEditingController();
  bool _loading = false;
  ApiException? _error;

  @override
  void dispose() {
    _email.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    FocusScope.of(context).unfocus(); // fecha o teclado antes de navegar ou exibir erro
    if (_loading || !_form.currentState!.validate()) return;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      await ref.read(sessionProvider.notifier).login(_email.text.trim(), _password.text);
      // O roteador redireciona para o mapa quando a sessão muda.
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return _AuthScaffold(
      title: 'Entrar',
      subtitle: 'Acesse sua conta para registrar e acompanhar ocorrências.',
      children: [
        _FormError(_error?.message),
        Form(
          key: _form,
          child: AutofillGroup(
            child: Column(
              children: [
                TextFormField(
                  controller: _email,
                  keyboardType: TextInputType.emailAddress,
                  textInputAction: TextInputAction.next,
                  autofillHints: const [AutofillHints.email],
                  validator: Validators.email,
                  decoration: InputDecoration(
                    labelText: 'E-mail',
                    prefixIcon: const Icon(Icons.mail_outline),
                    errorText: _error?.fieldError('email'),
                  ),
                ),
                const SizedBox(height: AcSpacing.lg),
                PasswordField(
                  controller: _password,
                  label: 'Senha',
                  validator: (v) => (v == null || v.isEmpty) ? 'Informe sua senha' : null,
                  textInputAction: TextInputAction.done,
                  onSubmitted: (_) => _submit(),
                ),
              ],
            ),
          ),
        ),
        Align(
          alignment: Alignment.centerRight,
          child: TextButton(
            onPressed: () => context.push('/forgot-password'),
            child: const Text('Esqueci minha senha'),
          ),
        ),
        const SizedBox(height: AcSpacing.md),
        PrimaryButton(label: 'Entrar', loading: _loading, onPressed: _submit),
        const SizedBox(height: AcSpacing.lg),
        Row(
          mainAxisAlignment: MainAxisAlignment.center,
          children: [
            Text('Não tem conta?', style: AcTypeScale.body.copyWith(color: AcColors.textSecondary)),
            TextButton(onPressed: () => context.pushReplacement('/register'), child: const Text('Cadastre-se')),
          ],
        ),
      ],
    );
  }
}

// ---------------------------------------------------------------------------
// Cadastro
// ---------------------------------------------------------------------------

class RegisterPage extends ConsumerStatefulWidget {
  const RegisterPage({super.key});

  @override
  ConsumerState<RegisterPage> createState() => _RegisterPageState();
}

class _RegisterPageState extends ConsumerState<RegisterPage> {
  final _form = GlobalKey<FormState>();
  final _name = TextEditingController();
  final _email = TextEditingController();
  final _password = TextEditingController();
  final _confirm = TextEditingController();
  bool _accepted = false;
  bool _showTermsError = false;
  bool _loading = false;
  ApiException? _error;

  @override
  void dispose() {
    for (final c in [_name, _email, _password, _confirm]) {
      c.dispose();
    }
    super.dispose();
  }

  Future<void> _submit() async {
    FocusScope.of(context).unfocus(); // fecha o teclado antes de navegar ou exibir erro
    final valid = _form.currentState!.validate();
    setState(() => _showTermsError = !_accepted);
    if (_loading || !valid || !_accepted) return;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      await ref.read(sessionProvider.notifier).register(_name.text.trim(), _email.text.trim(), _password.text);
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return _AuthScaffold(
      title: 'Criar conta',
      subtitle: 'Participe do monitoramento colaborativo da sua cidade.',
      children: [
        _FormError(_error?.fieldErrors.isEmpty ?? true ? _error?.message : null),
        Form(
          key: _form,
          child: AutofillGroup(
            child: Column(
              children: [
                TextFormField(
                  controller: _name,
                  textCapitalization: TextCapitalization.words,
                  textInputAction: TextInputAction.next,
                  autofillHints: const [AutofillHints.name],
                  validator: Validators.name,
                  decoration: InputDecoration(
                    labelText: 'Nome',
                    prefixIcon: const Icon(Icons.person_outline),
                    errorText: _error?.fieldError('name'),
                  ),
                ),
                const SizedBox(height: AcSpacing.lg),
                TextFormField(
                  controller: _email,
                  keyboardType: TextInputType.emailAddress,
                  textInputAction: TextInputAction.next,
                  autofillHints: const [AutofillHints.email],
                  validator: Validators.email,
                  decoration: InputDecoration(
                    labelText: 'E-mail',
                    prefixIcon: const Icon(Icons.mail_outline),
                    errorText: _error?.fieldError('email'),
                  ),
                ),
                const SizedBox(height: AcSpacing.lg),
                PasswordField(
                  controller: _password,
                  label: 'Senha',
                  validator: Validators.password,
                  errorText: _error?.fieldError('password'),
                  helperText: 'Mínimo de 8 caracteres, com maiúscula, minúscula e número.',
                  textInputAction: TextInputAction.next,
                ),
                const SizedBox(height: AcSpacing.lg),
                PasswordField(
                  controller: _confirm,
                  label: 'Confirmar senha',
                  validator: (v) => v != _password.text ? 'As senhas não coincidem' : null,
                  textInputAction: TextInputAction.done,
                  onSubmitted: (_) => _submit(),
                ),
              ],
            ),
          ),
        ),
        const SizedBox(height: AcSpacing.md),
        CheckboxListTile(
          value: _accepted,
          onChanged: (v) => setState(() {
            _accepted = v ?? false;
            _showTermsError = false;
          }),
          contentPadding: EdgeInsets.zero,
          controlAffinity: ListTileControlAffinity.leading,
          title: Text('Li e aceito os termos de uso e a política de privacidade', style: AcTypeScale.body),
          subtitle: _showTermsError
              ? Text('É necessário aceitar para continuar', style: AcTypeScale.caption.copyWith(color: AcColors.error))
              : TextButton(
                  style: TextButton.styleFrom(padding: EdgeInsets.zero, alignment: Alignment.centerLeft),
                  onPressed: () => showDialog<void>(context: context, builder: (_) => const PrivacyDialog()),
                  child: const Text('Ler a política de privacidade'),
                ),
        ),
        const SizedBox(height: AcSpacing.lg),
        PrimaryButton(label: 'Criar conta', loading: _loading, onPressed: _submit),
      ],
    );
  }
}

class PrivacyDialog extends StatelessWidget {
  const PrivacyDialog({super.key});

  @override
  Widget build(BuildContext context) {
    return AlertDialog(
      title: const Text('Privacidade (LGPD)'),
      content: const SingleChildScrollView(
        child: Text(
          '• Coletamos nome, e-mail e as ocorrências que você registra.\n'
          '• Sua localização só é usada quando você permite, para mostrar ocorrências próximas e registrar o local de um alagamento.\n'
          '• Fotos enviadas têm os metadados (incluindo GPS) removidos.\n'
          '• Outros usuários veem apenas seu primeiro nome nos relatos.\n'
          '• Você pode exportar seus dados ou excluir sua conta a qualquer momento em Perfil.\n'
          '• Relatos de cidadãos não são informação oficial.',
        ),
      ),
      actions: [TextButton(onPressed: () => Navigator.pop(context), child: const Text('Entendi'))],
    );
  }
}

// ---------------------------------------------------------------------------
// Recuperação de senha
// ---------------------------------------------------------------------------

class ForgotPasswordPage extends ConsumerStatefulWidget {
  const ForgotPasswordPage({super.key});

  @override
  ConsumerState<ForgotPasswordPage> createState() => _ForgotPasswordPageState();
}

class _ForgotPasswordPageState extends ConsumerState<ForgotPasswordPage> {
  final _form = GlobalKey<FormState>();
  final _email = TextEditingController();
  bool _loading = false;
  String? _error;

  @override
  void dispose() {
    _email.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    FocusScope.of(context).unfocus(); // fecha o teclado antes de navegar ou exibir erro
    if (_loading || !_form.currentState!.validate()) return;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      await ref.read(authRepositoryProvider).forgotPassword(_email.text.trim());
      if (mounted) context.pushReplacement('/forgot-password/verify', extra: _email.text.trim());
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e.message);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return _AuthScaffold(
      title: 'Recuperar senha',
      subtitle: 'Informe seu e-mail. Se ele estiver cadastrado, enviaremos um código de 6 dígitos.',
      children: [
        _FormError(_error),
        Form(
          key: _form,
          child: TextFormField(
            controller: _email,
            keyboardType: TextInputType.emailAddress,
            validator: Validators.email,
            onFieldSubmitted: (_) => _submit(),
            decoration: const InputDecoration(labelText: 'E-mail', prefixIcon: Icon(Icons.mail_outline)),
          ),
        ),
        const SizedBox(height: AcSpacing.xl),
        PrimaryButton(label: 'Enviar código', loading: _loading, onPressed: _submit),
      ],
    );
  }
}

class ResetPasswordPage extends ConsumerStatefulWidget {
  const ResetPasswordPage({super.key, required this.email});

  final String email;

  @override
  ConsumerState<ResetPasswordPage> createState() => _ResetPasswordPageState();
}

class _ResetPasswordPageState extends ConsumerState<ResetPasswordPage> {
  final _form = GlobalKey<FormState>();
  final _code = TextEditingController();
  final _password = TextEditingController();
  bool _loading = false;
  ApiException? _error;

  @override
  void dispose() {
    _code.dispose();
    _password.dispose();
    super.dispose();
  }

  Future<void> _submit() async {
    FocusScope.of(context).unfocus(); // fecha o teclado antes de navegar ou exibir erro
    if (_loading || !_form.currentState!.validate()) return;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      await ref
          .read(authRepositoryProvider)
          .resetPassword(email: widget.email, code: _code.text.trim(), newPassword: _password.text);
      if (!mounted) return;
      showAppSnackbar(context, 'Senha redefinida. Entre com a nova senha.', kind: SnackKind.success);
      context.go('/login');
    } on ApiException catch (e) {
      if (mounted) setState(() => _error = e);
    } finally {
      if (mounted) setState(() => _loading = false);
    }
  }

  @override
  Widget build(BuildContext context) {
    return _AuthScaffold(
      title: 'Verificar código',
      subtitle: 'Digite o código enviado para ${widget.email} e escolha uma nova senha. O código expira em 15 minutos.',
      children: [
        _FormError(_error?.fieldErrors.isEmpty ?? true ? _error?.message : null),
        Form(
          key: _form,
          child: Column(
            children: [
              TextFormField(
                controller: _code,
                keyboardType: TextInputType.number,
                maxLength: 6,
                validator: (v) => RegExp(r'^\d{6}$').hasMatch(v ?? '') ? null : 'Digite os 6 dígitos do código',
                decoration: InputDecoration(
                  labelText: 'Código',
                  prefixIcon: const Icon(Icons.pin_outlined),
                  errorText: _error?.fieldError('code'),
                ),
              ),
              const SizedBox(height: AcSpacing.sm),
              PasswordField(
                controller: _password,
                label: 'Nova senha',
                validator: Validators.password,
                errorText: _error?.fieldError('newPassword'),
                helperText: 'Mínimo de 8 caracteres, com maiúscula, minúscula e número.',
                onSubmitted: (_) => _submit(),
              ),
            ],
          ),
        ),
        const SizedBox(height: AcSpacing.xl),
        PrimaryButton(label: 'Redefinir senha', loading: _loading, onPressed: _submit),
        TextButton(onPressed: () => context.pushReplacement('/forgot-password'), child: const Text('Reenviar código')),
      ],
    );
  }
}
