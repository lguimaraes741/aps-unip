import '../core/network/api_client.dart';
import '../domain/models.dart';

class UsersRepository {
  UsersRepository(this._api);

  final ApiClient _api;

  Future<UserProfile> me() =>
      _api.call((dio) => dio.get<dynamic>('/users/me'), (d) => UserProfile.fromJson(d as Map<String, dynamic>));

  Future<UserProfile> updateName(String name) => _api.call(
        (dio) => dio.patch<dynamic>('/users/me', data: {'name': name}),
        (d) => UserProfile.fromJson(d as Map<String, dynamic>),
      );

  Future<void> changePassword({required String currentPassword, required String newPassword}) => _api.call(
        (dio) => dio.patch<dynamic>('/users/me/password', data: {'currentPassword': currentPassword, 'newPassword': newPassword}),
        (_) {},
      );

  Future<NotificationPreferences> preferences() => _api.call(
        (dio) => dio.get<dynamic>('/users/me/notification-preferences'),
        (d) => NotificationPreferences.fromJson(d as Map<String, dynamic>),
      );

  Future<NotificationPreferences> savePreferences(NotificationPreferences prefs) => _api.call(
        (dio) => dio.put<dynamic>('/users/me/notification-preferences', data: prefs.toJson()),
        (d) => NotificationPreferences.fromJson(d as Map<String, dynamic>),
      );

  /// LGPD: cópia de tudo que o AlertaCidade guarda sobre o titular.
  Future<Map<String, dynamic>> exportData() =>
      _api.call((dio) => dio.get<dynamic>('/users/me/export'), (d) => d as Map<String, dynamic>);

  Future<void> deleteAccount(String password) =>
      _api.call((dio) => dio.delete<dynamic>('/users/me', data: {'password': password}), (_) {});
}
