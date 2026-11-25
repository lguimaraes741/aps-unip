/// Validações locais — espelham as regras da API para dar retorno imediato.
/// A API continua validando (a interface nunca é a barreira de segurança).
abstract final class Validators {
  static final _email = RegExp(r'^[^@\s]+@[^@\s]+\.[^@\s]+$');
  static final _password = RegExp(r'^(?=.*[a-z])(?=.*[A-Z])(?=.*\d).{8,72}$');

  static String? email(String? value) {
    final v = value?.trim() ?? '';
    if (v.isEmpty) return 'Informe seu e-mail';
    if (!_email.hasMatch(v)) return 'E-mail inválido';
    return null;
  }

  static String? password(String? value) {
    if (value == null || value.isEmpty) return 'Informe uma senha';
    if (!_password.hasMatch(value)) return 'Use de 8 a 72 caracteres, com maiúscula, minúscula e número';
    return null;
  }

  static String? name(String? value) {
    final v = value?.trim() ?? '';
    if (v.length < 2) return 'Informe seu nome';
    if (v.length > 120) return 'Nome muito longo';
    return null;
  }

  static String? Function(String?) length(String label, int min, int max) => (value) {
        final v = value?.trim() ?? '';
        if (v.isEmpty) return 'Informe $label';
        if (v.length < min) return '$label: mínimo de $min caracteres';
        if (v.length > max) return '$label: máximo de $max caracteres';
        return null;
      };
}
