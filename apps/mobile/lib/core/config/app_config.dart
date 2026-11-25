/// Configuração por ambiente, definida em tempo de build:
///   flutter run --dart-define=API_BASE_URL=http://192.168.0.10:3000
///
/// Padrão: `10.0.2.2`, o endereço do computador hospedeiro visto pelo emulador Android.
abstract final class AppConfig {
  static const apiBaseUrl = String.fromEnvironment('API_BASE_URL', defaultValue: 'http://10.0.2.2:3000');
  static const appEnv = String.fromEnvironment('APP_ENV', defaultValue: 'development');
  static const appVersion = '2.0.0';
  static const tileUrlTemplate = String.fromEnvironment(
    'MAP_TILE_URL',
    defaultValue: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png',
  );

  /// Identificação exigida pela política de uso dos tiles do OpenStreetMap.
  static const userAgentPackageName = 'br.unip.alertacidade.alertacidade';

  static String get apiUrl => '$apiBaseUrl/api/v1';

  static bool get isProduction => appEnv == 'production';

  /// Converte caminhos relativos devolvidos pela API (ex.: `/api/v1/photos/…`) em URL absoluta.
  static String absoluteUrl(String pathOrUrl) =>
      pathOrUrl.startsWith('http') ? pathOrUrl : '$apiBaseUrl$pathOrUrl';
}
