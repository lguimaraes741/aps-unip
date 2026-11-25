import 'package:dio/dio.dart';

import '../core/network/api_client.dart';
import '../domain/models.dart';

/// Filtros da tela do mapa — enviados à API, que aplica a consulta no banco (PostGIS).
class OccurrenceFilters {
  const OccurrenceFilters({
    this.severities = const {},
    this.statuses = const {},
    this.radiusMeters = 5000,
    this.periodHours,
    this.query,
  });

  final Set<Severity> severities;
  final Set<OccurrenceStatus> statuses;
  final int radiusMeters;
  final int? periodHours;
  final String? query;

  bool get isDefault => severities.isEmpty && statuses.isEmpty && radiusMeters == 5000 && periodHours == null && (query ?? '').isEmpty;

  OccurrenceFilters copyWith({
    Set<Severity>? severities,
    Set<OccurrenceStatus>? statuses,
    int? radiusMeters,
    int? Function()? periodHours,
    String? Function()? query,
  }) =>
      OccurrenceFilters(
        severities: severities ?? this.severities,
        statuses: statuses ?? this.statuses,
        radiusMeters: radiusMeters ?? this.radiusMeters,
        periodHours: periodHours != null ? periodHours() : this.periodHours,
        query: query != null ? query() : this.query,
      );

  Map<String, dynamic> toQuery({double? lat, double? lng}) => {
        if (lat != null && lng != null) ...{'lat': lat, 'lng': lng, 'radius': radiusMeters},
        if (severities.isNotEmpty) 'severity': severities.map((s) => s.api).join(','),
        if (statuses.isNotEmpty) 'status': statuses.map((s) => s.api).join(','),
        if (periodHours != null) 'periodHours': periodHours,
        if ((query ?? '').trim().isNotEmpty) 'q': query!.trim(),
      };
}

class NewOccurrence {
  const NewOccurrence({
    required this.clientRequestId,
    required this.title,
    required this.description,
    required this.address,
    required this.neighborhood,
    required this.latitude,
    required this.longitude,
    required this.severity,
    required this.occurredAt,
  });

  /// Chave de idempotência: gerada uma vez por rascunho; reenvios não duplicam o registro.
  final String clientRequestId;
  final String title;
  final String description;
  final String address;
  final String? neighborhood;
  final double latitude;
  final double longitude;
  final Severity severity;
  final DateTime occurredAt;

  Map<String, dynamic> toJson() => {
        'clientRequestId': clientRequestId,
        'title': title,
        'description': description,
        'address': address,
        if (neighborhood != null && neighborhood!.isNotEmpty) 'neighborhood': neighborhood,
        'latitude': latitude,
        'longitude': longitude,
        'severity': severity.api,
        'occurredAt': occurredAt.toUtc().toIso8601String(),
      };
}

class ConfirmationResult {
  const ConfirmationResult(this.confirmCount, this.contestCount, this.myConfirmation);

  final int confirmCount;
  final int contestCount;
  final ConfirmationType? myConfirmation;
}

enum MineFilter {
  all('all', 'Todos'),
  pending('pending', 'Pendentes'),
  validated('validated', 'Validados'),
  resolved('resolved', 'Resolvidos');

  const MineFilter(this.api, this.label);
  final String api;
  final String label;
}

class OccurrencesRepository {
  OccurrencesRepository(this._api);

  final ApiClient _api;

  Future<Paged<OccurrenceSummary>> list(OccurrenceFilters filters, {double? lat, double? lng, int page = 1, int limit = 50}) =>
      _api.call(
        (dio) => dio.get<dynamic>('/occurrences', queryParameters: {...filters.toQuery(lat: lat, lng: lng), 'page': page, 'limit': limit}),
        (d) => Paged.fromJson(d as Map<String, dynamic>, OccurrenceSummary.fromJson),
      );

  Future<OccurrenceDetail> detail(String id, {double? lat, double? lng}) => _api.call(
        (dio) => dio.get<dynamic>('/occurrences/$id', queryParameters: {if (lat != null && lng != null) ...{'lat': lat, 'lng': lng}}),
        (d) => OccurrenceDetail.fromJson(d as Map<String, dynamic>),
      );

  Future<OccurrenceDetail> create(NewOccurrence data) => _api.call(
        (dio) => dio.post<dynamic>('/occurrences', data: data.toJson()),
        (d) => OccurrenceDetail.fromJson(d as Map<String, dynamic>),
      );

  Future<OccurrencePhoto> uploadPhoto(String occurrenceId, String filePath, {void Function(double progress)? onProgress}) async {
    final form = FormData.fromMap({'photo': await MultipartFile.fromFile(filePath, filename: filePath.split(RegExp(r'[\\/]')).last)});
    return _api.call(
      (dio) => dio.post<dynamic>(
        '/occurrences/$occurrenceId/photos',
        data: form,
        onSendProgress: onProgress == null ? null : (sent, total) => total > 0 ? onProgress(sent / total) : null,
      ),
      (d) => OccurrencePhoto.fromJson(d as Map<String, dynamic>),
    );
  }

  Future<Paged<OccurrenceSummary>> mine({MineFilter filter = MineFilter.all, String? query, int page = 1}) => _api.call(
        (dio) => dio.get<dynamic>('/occurrences/mine', queryParameters: {
          'filter': filter.api,
          if ((query ?? '').trim().isNotEmpty) 'q': query!.trim(),
          'page': page,
          'limit': 20,
        }),
        (d) => Paged.fromJson(d as Map<String, dynamic>, OccurrenceSummary.fromJson),
      );

  Future<MySummary> mySummary() =>
      _api.call((dio) => dio.get<dynamic>('/occurrences/mine/summary'), (d) => MySummary.fromJson(d as Map<String, dynamic>));

  Future<ConfirmationResult> setConfirmation(String id, ConfirmationType? type) => _api.call(
        (dio) => type == null
            ? dio.delete<dynamic>('/occurrences/$id/confirmation')
            : dio.put<dynamic>('/occurrences/$id/confirmation', data: {'type': type.api}),
        (d) {
          final m = d as Map<String, dynamic>;
          return ConfirmationResult(m['confirmCount'] as int, m['contestCount'] as int, ConfirmationType.fromApi(m['myConfirmation'] as String?));
        },
      );

  Future<void> setSaved(String id, bool saved) =>
      _api.call((dio) => saved ? dio.put<dynamic>('/occurrences/$id/save') : dio.delete<dynamic>('/occurrences/$id/save'), (_) {});

  Future<void> report(String id, String reason, {String? details}) => _api.call(
        (dio) => dio.post<dynamic>('/occurrences/$id/reports', data: {'reason': reason, if (details != null && details.isNotEmpty) 'details': details}),
        (_) {},
      );

  Future<void> remove(String id) => _api.call((dio) => dio.delete<dynamic>('/occurrences/$id'), (_) {});
}
