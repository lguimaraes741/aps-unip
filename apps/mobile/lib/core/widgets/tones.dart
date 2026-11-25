import 'package:material_ui/material_ui.dart';

import '../../domain/models.dart';
import '../theme/app_tokens.g.dart';

/// Ponte entre os enums do domínio e as paletas do design system.
extension SeverityTone on Severity {
  AcTonePalette get palette => AcSeverityColors.byApiValue[api]!;

  /// Fundo de cabeçalhos com texto branco: a versão ESCURA da cor do nível (contraste ≥ 6:1);
  /// verde e âmbar claros não dariam contraste suficiente com texto branco.
  Color get headerColor => this == Severity.critical ? palette.base : palette.fg;

  /// Um formato por nível (gota vazada → gota cheia → ondas → alerta): a gravidade
  /// é reconhecível mesmo sem distinguir as cores (daltonismo, sol forte na tela).
  IconData get icon => switch (this) {
        Severity.low => Icons.water_drop_outlined,
        Severity.moderate => Icons.water_drop,
        Severity.high => Icons.waves,
        Severity.critical => Icons.warning_rounded,
      };

  /// Como reconhecer o nível (usado no registro e na legenda).
  String get hint => switch (this) {
        Severity.low => 'Poças ou lâmina d’água; trânsito normal.',
        Severity.moderate => 'Água acima do meio-fio; trânsito lento.',
        Severity.high => 'Via parcialmente bloqueada; risco a veículos.',
        Severity.critical => 'Via intransitável ou água em imóveis; risco a pessoas.',
      };

  /// O que fazer (orientação geral de segurança, sem alarmismo).
  String get guidance => switch (this) {
        Severity.low => 'Atenção ao passar pelo local e evite poças profundas.',
        Severity.moderate => 'Evite a região se puder e não atravesse trechos com água em movimento.',
        Severity.high => 'Não atravesse a via; use uma rota alternativa e acompanhe as atualizações.',
        Severity.critical => 'Não se aproxime. Havendo risco a pessoas ou imóveis, ligue 199 (Defesa Civil) ou 193 (Bombeiros).',
      };
}

extension StatusTone on OccurrenceStatus {
  AcTonePalette get palette => AcStatusColors.byApiValue[api]!;

  /// Status sempre acompanha um ícone: a cor nunca é o único indicador.
  IconData get icon => switch (this) {
        OccurrenceStatus.pending => Icons.schedule,
        OccurrenceStatus.underReview => Icons.manage_search,
        OccurrenceStatus.validated => Icons.verified_outlined,
        OccurrenceStatus.rejected => Icons.block,
        OccurrenceStatus.resolved => Icons.task_alt,
      };
}
