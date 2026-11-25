import 'package:dio/dio.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'app_config.dart';

/// Endereço do servidor configurável no aparelho (sem gerar outro APK).
abstract final class ServerSettings {
  static const prefsKey = 'server_base_url';

  /// Lê o endereço salvo (chamado em `main`, antes de criar o cliente HTTP).
  static Future<void> load() async {
    try {
      final prefs = await SharedPreferences.getInstance();
      final saved = prefs.getString(prefsKey);
      AppConfig.setOverride(saved == null ? null : normalizeServerUrl(saved));
    } catch (_) {
      AppConfig.setOverride(null); // sem armazenamento: usa o endereço da compilação
    }
  }

  static Future<void> save(String baseUrl) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(prefsKey, baseUrl);
    AppConfig.setOverride(baseUrl);
  }

  static Future<void> reset() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(prefsKey);
    AppConfig.setOverride(null);
  }
}

/// Normaliza o que a pessoa digitou: sem esquema → https; remove barras e um "/api/v1" no fim.
/// Devolve `null` se não for um endereço http(s) válido.
String? normalizeServerUrl(String input) {
  var s = input.trim();
  if (s.isEmpty) return null;
  if (!RegExp(r'^[a-zA-Z][a-zA-Z0-9+.-]*://').hasMatch(s)) s = 'https://$s';
  final uri = Uri.tryParse(s);
  if (uri == null || !(uri.scheme == 'https' || uri.scheme == 'http') || uri.host.isEmpty) return null;
  if (uri.hasQuery || uri.hasFragment || uri.userInfo.isNotEmpty) return null;
  var path = uri.path.replaceAll(RegExp(r'/+$'), '');
  if (path.endsWith('/api/v1')) path = path.substring(0, path.length - '/api/v1'.length);
  return '${uri.scheme}://${uri.host}${uri.hasPort ? ':${uri.port}' : ''}$path';
}

/// Resultado do teste de um endereço.
enum ServerCheck { ok, unreachable, notAlertaCidade }

/// Confere se o endereço responde como uma API do AlertaCidade (`GET /api/v1/health`).
Future<ServerCheck> checkServer(String baseUrl, {Dio? dio}) async {
  final client = dio ?? Dio(BaseOptions(connectTimeout: const Duration(seconds: 10), receiveTimeout: const Duration(seconds: 10)));
  try {
    final res = await client.get<dynamic>('$baseUrl/api/v1/health');
    final data = res.data;
    final ok = data is Map && (data['status'] == 'ok' || data['status'] == 'degraded') && data['checks'] is Map;
    return ok ? ServerCheck.ok : ServerCheck.notAlertaCidade;
  } on DioException catch (e) {
    return e.response != null ? ServerCheck.notAlertaCidade : ServerCheck.unreachable;
  } catch (_) {
    return ServerCheck.notAlertaCidade;
  }
}
