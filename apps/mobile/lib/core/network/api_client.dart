import 'package:dio/dio.dart';

import '../config/app_config.dart';
import '../storage/token_storage.dart';
import 'api_exception.dart';

/// Cliente HTTP da API do AlertaCidade.
///
/// - Anexa o JWT de acesso a cada requisição.
/// - Ao receber 401, renova a sessão UMA única vez (interceptador em fila: requisições
///   concorrentes aguardam a mesma renovação) e repete a requisição original.
/// - Se a renovação falhar, limpa a sessão e notifica [onSessionExpired].
class ApiClient {
  ApiClient({required this.storage, Dio? dio, Dio? refreshDio, this.onSessionExpired})
      : dio = dio ?? Dio(_options()),
        _refreshDio = refreshDio ?? Dio(_options()) {
    this.dio.interceptors.add(QueuedInterceptorsWrapper(onRequest: _onRequest, onError: _onError));
  }

  final TokenStorage storage;
  final Dio dio;
  final Dio _refreshDio;
  void Function()? onSessionExpired;

  static BaseOptions _options() => BaseOptions(
        baseUrl: AppConfig.apiUrl,
        connectTimeout: const Duration(seconds: 10),
        receiveTimeout: const Duration(seconds: 20),
        sendTimeout: const Duration(seconds: 60),
        headers: {'Accept': 'application/json'},
      );

  static const _retriedKey = 'alertacidade.retried';

  void _onRequest(RequestOptions options, RequestInterceptorHandler handler) {
    final token = storage.accessToken;
    if (token != null && !options.path.startsWith('/auth/')) {
      options.headers['Authorization'] = 'Bearer $token';
    }
    handler.next(options);
  }

  Future<void> _onError(DioException error, ErrorInterceptorHandler handler) async {
    final request = error.requestOptions;
    final unauthorized = error.response?.statusCode == 401;
    if (!unauthorized || request.path.startsWith('/auth/') || request.extra[_retriedKey] == true) {
      return handler.next(error);
    }

    // Outra requisição da fila já renovou a sessão: apenas repete com o token novo.
    final sentToken = (request.headers['Authorization'] as String?)?.replaceFirst('Bearer ', '');
    final current = storage.accessToken;
    final renewed = current != null && current != sentToken ? true : await _refresh();
    if (!renewed) {
      await storage.clear();
      onSessionExpired?.call();
      return handler.next(error);
    }

    try {
      request.extra[_retriedKey] = true;
      request.headers['Authorization'] = 'Bearer ${storage.accessToken}';
      handler.resolve(await dio.fetch<dynamic>(request));
    } on DioException catch (e) {
      handler.next(e);
    }
  }

  Future<bool> _refresh() async {
    final refreshToken = await storage.readRefreshToken();
    if (refreshToken == null) return false;
    try {
      final res = await _refreshDio.post<Map<String, dynamic>>('/auth/refresh', data: {'refreshToken': refreshToken});
      final data = res.data!;
      await storage.save(accessToken: data['accessToken'] as String, refreshToken: data['refreshToken'] as String);
      return true;
    } on DioException {
      return false;
    }
  }

  /// Aplica o endereço atual de [AppConfig] (o usuário trocou o servidor no aparelho).
  void updateBaseUrl() {
    dio.options.baseUrl = AppConfig.apiUrl;
    _refreshDio.options.baseUrl = AppConfig.apiUrl;
  }

  /// Executa a chamada convertendo falhas em [ApiException].
  Future<T> call<T>(Future<Response<dynamic>> Function(Dio dio) request, T Function(dynamic data) parse) async {
    try {
      final response = await request(dio);
      return parse(response.data);
    } on DioException catch (e) {
      throw ApiException.fromDio(e);
    }
  }
}
