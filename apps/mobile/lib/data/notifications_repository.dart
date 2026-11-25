import '../core/network/api_client.dart';
import '../domain/models.dart';

/// Caixa de alertas, tokens de push e sincronização de eventos (Fase 4).
class NotificationsRepository {
  NotificationsRepository(this._api);

  final ApiClient _api;

  Future<NotificationsPage> list({NotificationFilter filter = NotificationFilter.all, int page = 1, int limit = 20}) => _api.call(
        (dio) => dio.get<dynamic>('/notifications', queryParameters: {'filter': filter.api, 'page': page, 'limit': limit}),
        (d) => NotificationsPage.fromJson(d as Map<String, dynamic>),
      );

  Future<void> markRead(String id) => _api.call((dio) => dio.post<dynamic>('/notifications/$id/read'), (_) {});

  Future<void> markAllRead() => _api.call((dio) => dio.post<dynamic>('/notifications/read-all'), (_) {});

  Future<void> registerDevice(String token, {String platform = 'ANDROID'}) =>
      _api.call((dio) => dio.put<dynamic>('/devices', data: {'token': token, 'platform': platform}), (_) {});

  Future<void> removeDevice(String token) => _api.call((dio) => dio.delete<dynamic>('/devices/${Uri.encodeComponent(token)}'), (_) {});

  /// Eventos publicados depois de [since]; sem [since], só o cursor atual.
  /// Passa pelo [ApiClient]: se o token de acesso expirou, ele é renovado na fila única
  /// do interceptador (nunca em paralelo, o que a API trataria como reuso de refresh token).
  Future<SyncResult> sync({BigInt? since, int limit = 200}) => _api.call(
        (dio) => dio.get<dynamic>('/sync', queryParameters: {if (since != null) 'since': since.toString(), 'limit': limit}),
        (d) => SyncResult.fromJson(d as Map<String, dynamic>),
      );
}
