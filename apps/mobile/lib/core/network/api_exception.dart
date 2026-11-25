import 'package:dio/dio.dart';

enum ApiErrorKind { network, timeout, unauthorized, forbidden, notFound, validation, conflict, tooManyRequests, server, unknown }

/// Erro da API em formato amigável para a interface.
/// `fieldErrors` permite exibir a mensagem ao lado de cada campo do formulário.
class ApiException implements Exception {
  const ApiException(this.kind, this.message, {this.statusCode, this.fieldErrors = const {}});

  final ApiErrorKind kind;
  final String message;
  final int? statusCode;
  final Map<String, List<String>> fieldErrors;

  bool get isConnectivity => kind == ApiErrorKind.network || kind == ApiErrorKind.timeout;

  String? fieldError(String field) {
    final list = fieldErrors[field];
    return list == null || list.isEmpty ? null : list.first;
  }

  factory ApiException.fromDio(DioException e) {
    switch (e.type) {
      case DioExceptionType.connectionTimeout:
      case DioExceptionType.sendTimeout:
      case DioExceptionType.receiveTimeout:
        return const ApiException(ApiErrorKind.timeout, 'O servidor demorou para responder. Tente novamente.');
      case DioExceptionType.connectionError:
        return const ApiException(ApiErrorKind.network, 'Sem conexão com o servidor. Verifique sua internet.');
      default:
        break;
    }
    final response = e.response;
    if (response == null) {
      return const ApiException(ApiErrorKind.unknown, 'Não foi possível concluir a operação.');
    }
    return ApiException.fromResponse(response.statusCode ?? 0, response.data);
  }

  factory ApiException.fromResponse(int status, Object? data) {
    String? message;
    final fieldErrors = <String, List<String>>{};
    if (data is Map) {
      final raw = data['message'];
      if (raw is String) message = raw;
      if (raw is List && raw.isNotEmpty) message = raw.first.toString();
      final errors = data['errors'];
      if (errors is Map) {
        errors.forEach((key, value) {
          if (value is List) fieldErrors[key.toString()] = value.map((v) => v.toString()).toList();
        });
      }
    }
    final kind = switch (status) {
      400 || 422 => ApiErrorKind.validation,
      401 => ApiErrorKind.unauthorized,
      403 => ApiErrorKind.forbidden,
      404 => ApiErrorKind.notFound,
      409 => ApiErrorKind.conflict,
      413 || 415 => ApiErrorKind.validation,
      429 => ApiErrorKind.tooManyRequests,
      >= 500 => ApiErrorKind.server,
      _ => ApiErrorKind.unknown,
    };
    final fallback = switch (kind) {
      ApiErrorKind.tooManyRequests => 'Muitas tentativas. Aguarde um minuto e tente novamente.',
      ApiErrorKind.server => 'O servidor está indisponível no momento. Tente novamente.',
      ApiErrorKind.notFound => 'Registro não encontrado.',
      ApiErrorKind.forbidden => 'Você não tem permissão para esta ação.',
      _ => 'Não foi possível concluir a operação.',
    };
    return ApiException(kind, message ?? fallback, statusCode: status, fieldErrors: fieldErrors);
  }

  @override
  String toString() => 'ApiException($kind, $statusCode): $message';
}
