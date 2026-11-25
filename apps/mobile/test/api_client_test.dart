import 'dart:convert';
import 'dart:typed_data';

import 'package:alertacidade/core/network/api_client.dart';
import 'package:alertacidade/core/network/api_exception.dart';
import 'package:alertacidade/core/storage/token_storage.dart';
import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';

/// Servidor HTTP simulado em memória.
class FakeAdapter implements HttpClientAdapter {
  FakeAdapter(this.handler);

  final Future<(int, Object?)> Function(RequestOptions options) handler;

  @override
  Future<ResponseBody> fetch(RequestOptions options, Stream<Uint8List>? requestStream, Future<void>? cancelFuture) async {
    final (status, body) = await handler(options);
    return ResponseBody.fromString(jsonEncode(body), status, headers: {
      Headers.contentTypeHeader: [Headers.jsonContentType],
    });
  }

  @override
  void close({bool force = false}) {}
}

void main() {
  late InMemoryTokenStorage storage;

  setUp(() async {
    storage = InMemoryTokenStorage();
    await storage.save(accessToken: 'expirado', refreshToken: 'refresh-1');
  });

  ApiClient build({required Future<(int, Object?)> Function(RequestOptions) api, required Future<(int, Object?)> Function(RequestOptions) auth}) {
    final dio = Dio(BaseOptions(baseUrl: 'http://api.test'))..httpClientAdapter = FakeAdapter(api);
    final refreshDio = Dio(BaseOptions(baseUrl: 'http://api.test'))..httpClientAdapter = FakeAdapter(auth);
    return ApiClient(storage: storage, dio: dio, refreshDio: refreshDio);
  }

  test('401 simultâneos disparam UMA renovação e todas as requisições são repetidas', () async {
    var refreshCalls = 0;
    final client = build(
      api: (o) async => o.headers['Authorization'] == 'Bearer novo' ? (200, {'ok': o.path}) : (401, {'message': 'expirado'}),
      auth: (o) async {
        refreshCalls++;
        await Future<void>.delayed(const Duration(milliseconds: 20));
        return (200, {'accessToken': 'novo', 'refreshToken': 'refresh-2'});
      },
    );

    final results = await Future.wait([
      for (var i = 0; i < 5; i++) client.call((dio) => dio.get<dynamic>('/occurrences/$i'), (d) => (d as Map)['ok']),
    ]);

    expect(results, ['/occurrences/0', '/occurrences/1', '/occurrences/2', '/occurrences/3', '/occurrences/4']);
    expect(refreshCalls, 1);
    expect(await storage.readRefreshToken(), 'refresh-2');
  });

  test('falha na renovação encerra a sessão e notifica', () async {
    var expired = false;
    final client = build(
      api: (_) async => (401, {'message': 'expirado'}),
      auth: (_) async => (401, {'message': 'Sessão expirada'}),
    )..onSessionExpired = () => expired = true;

    await expectLater(
      client.call((dio) => dio.get<dynamic>('/users/me'), (d) => d),
      throwsA(isA<ApiException>().having((e) => e.kind, 'kind', ApiErrorKind.unauthorized)),
    );
    expect(expired, isTrue);
    expect(await storage.readRefreshToken(), isNull);
    expect(storage.accessToken, isNull);
  });

  test('rotas de autenticação não tentam renovar nem recebem o token', () async {
    String? sentAuth;
    var refreshCalls = 0;
    final client = build(
      api: (o) async {
        sentAuth = o.headers['Authorization'] as String?;
        return (401, {'message': 'E-mail ou senha incorretos'});
      },
      auth: (_) async {
        refreshCalls++;
        return (200, {});
      },
    );
    await expectLater(client.call((dio) => dio.post<dynamic>('/auth/login', data: {}), (d) => d), throwsA(isA<ApiException>()));
    expect(sentAuth, isNull);
    expect(refreshCalls, 0);
  });

  test('erro de validação chega com os erros por campo', () async {
    final client = build(
      api: (_) async => (400, {
            'message': ['title: tamanho inválido'],
            'errors': {
              'title': ['title: tamanho inválido'],
            },
          }),
      auth: (_) async => (500, null),
    );
    await expectLater(
      client.call((dio) => dio.post<dynamic>('/occurrences', data: {}), (d) => d),
      throwsA(isA<ApiException>().having((e) => e.fieldError('title'), 'title', 'title: tamanho inválido')),
    );
  });
}
