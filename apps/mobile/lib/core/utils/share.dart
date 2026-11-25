import 'package:share_plus/share_plus.dart';

import '../../domain/models.dart';
import 'formatters.dart';

/// Texto único de compartilhamento (mapa e detalhes): sempre deixa claro que é relato de
/// cidadão e leva o ponto no OpenStreetMap — funciona para quem não tem o app.
Future<void> shareOccurrence({
  required int code,
  required String title,
  required Severity severity,
  required OccurrenceStatus status,
  required String address,
  required String? neighborhood,
  required DateTime createdAt,
  required double latitude,
  required double longitude,
}) {
  final text = '$title — gravidade ${severity.label.toLowerCase()}, ${status.label.toLowerCase()}.\n'
      '${Formatters.place(address, neighborhood, separator: ', ')}\n'
      'Registrado em ${Formatters.dateTime(createdAt)} no AlertaCidade (relato de cidadão, não é informação oficial).\n'
      'https://www.openstreetmap.org/?mlat=$latitude&mlon=$longitude#map=17/$latitude/$longitude';
  return SharePlus.instance.share(ShareParams(text: text, subject: 'Ocorrência #$code — AlertaCidade'));
}
