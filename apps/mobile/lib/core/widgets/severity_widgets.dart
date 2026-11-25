import 'dart:math' as math;

import 'package:material_ui/material_ui.dart';

import '../../domain/models.dart';
import '../theme/app_tokens.g.dart';
import 'tones.dart';

/// Marcador do mapa em "bolha": círculo branco com a cor E o ícone da gravidade
/// (o formato muda por nível — nunca só a cor). Selecionado cresce e ganha anel;
/// resolvido fica esmaecido com selo de concluído.
class SeverityMarker extends StatelessWidget {
  const SeverityMarker({super.key, required this.severity, required this.status, this.selected = false});

  static const double size = 48;

  final Severity severity;
  final OccurrenceStatus status;
  final bool selected;

  @override
  Widget build(BuildContext context) {
    final resolved = status == OccurrenceStatus.resolved;
    final color = severity.palette.marker;
    return Semantics(
      button: true,
      label: 'Ocorrência de gravidade ${severity.label}, ${status.label}',
      excludeSemantics: true,
      child: AnimatedScale(
        scale: selected ? 1.2 : 1,
        duration: AcMotion.base,
        curve: Curves.easeOutBack,
        child: Opacity(
          opacity: resolved ? 0.6 : 1,
          child: Stack(
            clipBehavior: Clip.none,
            children: [
              AnimatedContainer(
                duration: AcMotion.base,
                width: size,
                height: size,
                padding: const EdgeInsets.all(5),
                decoration: BoxDecoration(
                  color: AcColors.surface,
                  shape: BoxShape.circle,
                  boxShadow: AcElevation.raised,
                  border: Border.all(color: selected ? color : AcColors.surface, width: selected ? 3 : 0),
                ),
                child: DecoratedBox(
                  decoration: BoxDecoration(color: color, shape: BoxShape.circle),
                  child: Icon(severity.icon, size: 20, color: AcColors.onPrimary),
                ),
              ),
              if (resolved)
                Positioned(
                  right: -2,
                  top: -2,
                  child: Container(
                    padding: const EdgeInsets.all(2),
                    decoration: const BoxDecoration(color: AcColors.success, shape: BoxShape.circle),
                    child: const Icon(Icons.check, size: 12, color: AcColors.onPrimary),
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

/// Medidor semicircular dos 4 níveis (como no protótipo): o ponteiro aponta o nível atual.
class SeverityGauge extends StatelessWidget {
  const SeverityGauge({super.key, required this.severity, this.width = 132});

  final Severity severity;
  final double width;

  @override
  Widget build(BuildContext context) {
    return Semantics(
      label: 'Medidor: gravidade ${severity.label}, nível ${severity.index + 1} de 4',
      excludeSemantics: true,
      child: TweenAnimationBuilder<double>(
        tween: Tween(begin: 0, end: severity.index.toDouble()),
        duration: MediaQuery.of(context).disableAnimations ? Duration.zero : AcMotion.slow * 2,
        curve: Curves.easeOutCubic,
        builder: (_, level, _) => CustomPaint(size: Size(width, width * 0.62), painter: _GaugePainter(level)),
      ),
    );
  }
}

class _GaugePainter extends CustomPainter {
  _GaugePainter(this.level);

  final double level; // 0..3 (animado)

  @override
  void paint(Canvas canvas, Size size) {
    final stroke = size.width * 0.11;
    final center = Offset(size.width / 2, size.height - stroke / 2);
    final radius = size.width / 2 - stroke / 2;
    final rect = Rect.fromCircle(center: center, radius: radius);
    const gap = 0.05;
    final segments = Severity.values;
    final sweep = math.pi / segments.length;
    for (var i = 0; i < segments.length; i++) {
      canvas.drawArc(
        rect,
        math.pi + i * sweep + gap / 2,
        sweep - gap,
        false,
        Paint()
          ..color = segments[i].palette.marker
          ..style = PaintingStyle.stroke
          ..strokeWidth = stroke
          ..strokeCap = StrokeCap.butt,
      );
    }
    // Ponteiro no meio do segmento do nível.
    final angle = math.pi + (level + 0.5) * sweep;
    final tip = center + Offset(math.cos(angle), math.sin(angle)) * (radius - stroke * 0.9);
    final needle = Paint()
      ..color = AcColors.textPrimary
      ..strokeWidth = stroke * 0.32
      ..strokeCap = StrokeCap.round;
    canvas.drawLine(center, tip, needle);
    canvas.drawCircle(center, stroke * 0.42, Paint()..color = AcColors.textPrimary);
  }

  @override
  bool shouldRepaint(_GaugePainter old) => old.level != level;
}

/// Folha "Entenda os níveis": os 4 níveis com cor, ícone, como reconhecer e o que fazer.
Future<void> showSeverityLevels(BuildContext context) {
  return showModalBottomSheet<void>(
    context: context,
    isScrollControlled: true,
    showDragHandle: true,
    useSafeArea: true,
    backgroundColor: AcColors.surface,
    shape: const RoundedRectangleBorder(borderRadius: BorderRadius.vertical(top: Radius.circular(AcRadius.xl))),
    builder: (context) => DraggableScrollableSheet(
      expand: false,
      initialChildSize: 0.75,
      maxChildSize: 0.92,
      builder: (context, scroll) => ListView(
        controller: scroll,
        padding: const EdgeInsets.fromLTRB(AcSpacing.xl, 0, AcSpacing.xl, AcSpacing.xxl),
        children: [
          Text('Níveis de gravidade', style: AcTypeScale.title, textAlign: TextAlign.center),
          const SizedBox(height: AcSpacing.xs),
          Text(
            'Informados por quem registrou. A moderação confere os relatos; nenhum nível é um comunicado oficial.',
            style: AcTypeScale.caption.copyWith(color: AcColors.textSecondary),
            textAlign: TextAlign.center,
          ),
          const SizedBox(height: AcSpacing.lg),
          for (final s in Severity.values) ...[
            const Divider(height: AcSpacing.xl),
            Semantics(
              container: true,
              label: 'Nível ${s.index + 1} de 4, ${s.label}. ${s.hint} ${s.guidance}',
              excludeSemantics: true,
              child: Row(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Container(
                    width: 36,
                    height: 36,
                    decoration: BoxDecoration(color: s.palette.marker, borderRadius: BorderRadius.circular(AcRadius.sm)),
                    child: Icon(s.icon, color: AcColors.onPrimary, size: 20),
                  ),
                  const SizedBox(width: AcSpacing.md),
                  Expanded(
                    child: Column(
                      crossAxisAlignment: CrossAxisAlignment.start,
                      children: [
                        Text.rich(TextSpan(children: [
                          TextSpan(text: s.label, style: AcTypeScale.subtitle),
                          TextSpan(text: '  ·  nível ${s.index + 1} de 4', style: AcTypeScale.caption.copyWith(color: AcColors.textSecondary)),
                        ])),
                        const SizedBox(height: AcSpacing.xxs),
                        Text(s.hint, style: AcTypeScale.body),
                        const SizedBox(height: AcSpacing.xs),
                        Text(s.guidance, style: AcTypeScale.label.copyWith(color: AcColors.textSecondary)),
                      ],
                    ),
                  ),
                ],
              ),
            ),
          ],
          const Divider(height: AcSpacing.xxl),
          Semantics(header: true, child: Text('Marcadores no mapa', style: AcTypeScale.subtitle)),
          const SizedBox(height: AcSpacing.sm),
          for (final (icon, round, text) in const [
            (Icons.water_drop, true, 'Bolha redonda: relato de cidadão.'),
            (Icons.newspaper, false, 'Quadrado com jornal: alerta montado a partir de notícias (não é comunicado oficial).'),
            (Icons.account_balance, false, 'Quadrado com prédio público: comunicado oficial.'),
            (Icons.crop_square, false, 'Área colorida: alerta que vale para a cidade inteira. Cinza tracejado = gravidade não informada.'),
          ])
            Padding(
              padding: const EdgeInsets.only(bottom: AcSpacing.sm),
              child: Row(children: [
                Container(
                  width: 32,
                  height: 32,
                  decoration: BoxDecoration(
                    color: AcColors.surface,
                    shape: round ? BoxShape.circle : BoxShape.rectangle,
                    borderRadius: round ? null : BorderRadius.circular(AcRadius.sm),
                    border: Border.all(color: AcColors.borderStrong, width: 2),
                  ),
                  child: Icon(icon, size: 18, color: AcColors.textSecondary),
                ),
                const SizedBox(width: AcSpacing.md),
                Expanded(child: Text(text, style: AcTypeScale.label)),
              ]),
            ),
        ],
      ),
    ),
  );
}
