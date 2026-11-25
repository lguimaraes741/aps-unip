import 'dart:convert';

import '../core/network/api_client.dart';
import '../core/network/api_exception.dart';
import '../domain/models.dart';

class AuthRepository {
  AuthRepository(this._api);

  final ApiClient _api;

  Future<UserProfile> login({required String email, required String password}) =>
      _authenticate('/auth/login', {'email': email, 'password': password});

  Future<UserProfile> register({required String name, required String email, required String password}) =>
      _authenticate('/auth/register', {'name': name, 'email': email, 'password': password, 'acceptTerms': true});

  /// Restaura a sessão salva. Sem conexão, usa o perfil em cache (a renovação do
  /// token ocorre automaticamente na primeira requisição quando a rede voltar).
  Future<UserProfile?> restore() async {
    final refreshToken = await _api.storage.readRefreshToken();
    if (refreshToken == null) return null;
    try {
      final data = await _api.call(
        (dio) => dio.post<dynamic>('/auth/refresh', data: {'refreshToken': refreshToken}),
        (d) => d as Map<String, dynamic>,
      );
      return await _persist(data);
    } on ApiException catch (e) {
      if (e.isConnectivity) {
        final cached = await _api.storage.readUserJson();
        if (cached != null) return UserProfile.fromJson(jsonDecode(cached) as Map<String, dynamic>);
      }
      await _api.storage.clear();
      return null;
    }
  }

  Future<void> logout() async {
    final refreshToken = await _api.storage.readRefreshToken();
    if (refreshToken != null) {
      try {
        await _api.dio.post<dynamic>('/auth/logout', data: {'refreshToken': refreshToken});
      } catch (_) {
        // Mesmo offline, a sessão local é encerrada; o token expira no servidor.
      }
    }
    await _api.storage.clear();
  }

  Future<void> forgotPassword(String email) =>
      _api.call((dio) => dio.post<dynamic>('/auth/forgot-password', data: {'email': email}), (_) {});

  Future<void> resetPassword({required String email, required String code, required String newPassword}) => _api.call(
        (dio) => dio.post<dynamic>('/auth/reset-password', data: {'email': email, 'code': code, 'newPassword': newPassword}),
        (_) {},
      );

  Future<UserProfile> _authenticate(String path, Map<String, dynamic> body) async {
    final data = await _api.call((dio) => dio.post<dynamic>(path, data: body), (d) => d as Map<String, dynamic>);
    return _persist(data);
  }

  Future<UserProfile> _persist(Map<String, dynamic> data) async {
    await _api.storage.save(accessToken: data['accessToken'] as String, refreshToken: data['refreshToken'] as String);
    final user = UserProfile.fromJson(data['user'] as Map<String, dynamic>);
    await _api.storage.saveUserJson(jsonEncode(user.toJson()));
    return user;
  }
}
