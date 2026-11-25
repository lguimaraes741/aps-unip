import 'package:intl/intl.dart';

/// Formatação para exibição em pt-BR. A API envia datas em UTC (ISO-8601);
/// aqui elas são convertidas para o fuso horário do aparelho.
abstract final class Formatters {
  static final _dateTime = DateFormat("dd/MM/yyyy 'às' HH:mm", 'pt_BR');
  static final _date = DateFormat('dd/MM/yyyy', 'pt_BR');
  static final _decimal = NumberFormat('0.0', 'pt_BR');

  static String dateTime(DateTime utc) => _dateTime.format(utc.toLocal());

  static String date(DateTime utc) => _date.format(utc.toLocal());

  /// "agora", "há 5 min", "há 2 h", "ontem", "há 3 dias", ou a data completa.
  static String relative(DateTime utc, {DateTime? now}) {
    final reference = (now ?? DateTime.now()).toUtc();
    final diff = reference.difference(utc.toUtc());
    if (diff.inSeconds < 60) return 'agora';
    if (diff.inMinutes < 60) return 'há ${diff.inMinutes} min';
    if (diff.inHours < 24) return 'há ${diff.inHours} h';
    if (diff.inDays == 1) return 'ontem';
    if (diff.inDays < 7) return 'há ${diff.inDays} dias';
    return date(utc);
  }

  /// "850 m", "1,2 km", "12 km".
  static String distance(num meters) {
    if (meters < 1000) return '${meters.round()} m';
    final km = meters / 1000;
    return km < 10 ? '${_decimal.format(km)} km' : '${km.round()} km';
  }

  /// Endereço seguido do bairro, sem repetir o bairro quando o endereço já o menciona
  /// ("Praça da Bandeira, Centro" + "Centro" → "Praça da Bandeira, Centro").
  static String place(String address, String? neighborhood, {String separator = ' · '}) {
    final n = neighborhood?.trim() ?? '';
    if (n.isEmpty || address.toLowerCase().contains(n.toLowerCase())) return address;
    return '$address$separator$n';
  }
}
