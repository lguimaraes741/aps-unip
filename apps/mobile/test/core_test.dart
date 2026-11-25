import 'package:alertacidade/app/router.dart';
import 'package:alertacidade/core/network/api_exception.dart';
import 'package:alertacidade/core/utils/formatters.dart';
import 'package:alertacidade/features/auth/validators.dart';
import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';
import 'package:intl/date_symbol_data_local.dart';

void main() {
  setUpAll(() => initializeDateFormatting('pt_BR'));

  group('Formatters', () {
    final now = DateTime.utc(2026, 11, 23, 15);

    test('tempo relativo', () {
      expect(Formatters.relative(now.subtract(const Duration(seconds: 30)), now: now), 'agora');
      expect(Formatters.relative(now.subtract(const Duration(minutes: 5)), now: now), 'há 5 min');
      expect(Formatters.relative(now.subtract(const Duration(hours: 3)), now: now), 'há 3 h');
      expect(Formatters.relative(now.subtract(const Duration(days: 1, hours: 2)), now: now), 'ontem');
      expect(Formatters.relative(now.subtract(const Duration(days: 4)), now: now), 'há 4 dias');
    });

    test('distância', () {
      expect(Formatters.distance(850), '850 m');
      expect(Formatters.distance(1234), '1,2 km');
      expect(Formatters.distance(12400), '12 km');
    });

    test('local sem repetir o bairro', () {
      expect(Formatters.place('Praça da Bandeira, Centro', 'Centro'), 'Praça da Bandeira, Centro');
      expect(Formatters.place('Av. do Estado, 1000', 'Cambuci'), 'Av. do Estado, 1000 · Cambuci');
      expect(Formatters.place('Rua A', null), 'Rua A');
      expect(Formatters.place('Rua A', '  '), 'Rua A');
      expect(Formatters.place('Rua A', 'Sé', separator: ', '), 'Rua A, Sé');
    });
  });

  group('ApiException', () {
    test('lê mensagens e erros por campo no formato da API', () {
      final e = ApiException.fromResponse(400, {
        'statusCode': 400,
        'message': ['email: E-mail inválido', 'password: A senha deve ter…'],
        'errors': {
          'email': ['E-mail inválido'],
          'password': ['A senha deve ter…'],
        },
      });
      expect(e.kind, ApiErrorKind.validation);
      expect(e.fieldError('email'), 'E-mail inválido');
      expect(e.fieldError('title'), isNull);
      expect(e.message, 'email: E-mail inválido');
    });

    test('mensagens padrão por status', () {
      expect(ApiException.fromResponse(429, null).message, contains('Muitas tentativas'));
      expect(ApiException.fromResponse(503, {'message': 'Banco indisponível'}).message, 'Banco indisponível');
      expect(ApiException.fromResponse(403, {}).kind, ApiErrorKind.forbidden);
    });

    test('falhas de rede são identificadas como conectividade', () {
      final e = ApiException.fromDio(
        DioException(
          requestOptions: RequestOptions(path: '/x'),
          type: DioExceptionType.connectionError,
        ),
      );
      expect(e.isConnectivity, isTrue);
      expect(e.message, contains('Sem conexão'));
    });
  });

  group('Validators (espelham a API)', () {
    test('senha', () {
      expect(Validators.password('fraca'), isNotNull);
      expect(Validators.password('semnumero A'), isNotNull);
      expect(Validators.password('Senha@123'), isNull);
    });

    test('e-mail e nome', () {
      expect(Validators.email('a@b'), isNotNull);
      expect(Validators.email(' maria@email.com '), isNull);
      expect(Validators.name(' A '), isNotNull);
    });
  });

  group('Redirecionamento de rotas', () {
    test('restaurando a sessão: sempre splash', () {
      expect(resolveRedirect(restoring: true, authenticated: false, location: '/map'), '/splash');
      expect(resolveRedirect(restoring: true, authenticated: false, location: '/splash'), isNull);
    });

    test('sem sessão: apenas rotas públicas', () {
      expect(resolveRedirect(restoring: false, authenticated: false, location: '/map'), '/welcome');
      expect(resolveRedirect(restoring: false, authenticated: false, location: '/occurrences/new'), '/welcome');
      expect(resolveRedirect(restoring: false, authenticated: false, location: '/login'), isNull);
      expect(resolveRedirect(restoring: false, authenticated: false, location: '/splash'), '/welcome');
    });

    test('com sessão: rotas públicas levam ao mapa', () {
      expect(resolveRedirect(restoring: false, authenticated: true, location: '/login'), '/map');
      expect(resolveRedirect(restoring: false, authenticated: true, location: '/splash'), '/map');
      expect(resolveRedirect(restoring: false, authenticated: true, location: '/occurrences/abc'), isNull);
    });
  });
}
