/// Alertas de notícia (News Intelligence, Fase 7) — espelham `GET /news/*` da API.
///
/// Valores desconhecidos (versão futura da API) nunca derrubam o app: caem no caso mais
/// conservador (ex.: nível desconhecido → "Preliminar").
library;

import 'package:latlong2/latlong.dart';

import 'models.dart';

enum NewsAlertLevel {
  preliminary('PRELIMINARY', 'Preliminar'),
  verified('VERIFIED', 'Verificado'),
  official('OFFICIAL', 'Comunicado oficial');

  const NewsAlertLevel(this.api, this.label);
  final String api;
  final String label;

  static NewsAlertLevel fromApi(String? value) => values.firstWhere((l) => l.api == value, orElse: () => preliminary);
}

enum NewsAlertStatus {
  active('ACTIVE', 'Em vigor'),
  resolved('RESOLVED', 'Encerrado'),
  expired('EXPIRED', 'Sem atualizações recentes'),
  retracted('RETRACTED', 'Retirado');

  const NewsAlertStatus(this.api, this.label);
  final String api;
  final String label;

  /// Desconhecido → tratado como não ativo (não aparece como alerta em vigor).
  static NewsAlertStatus fromApi(String? value) => values.firstWhere((s) => s.api == value, orElse: () => expired);
}

/// Precisão do local citado pelas fontes.
String precisionLabel(String? precision) => switch (precision) {
      'EXACT' => 'local exato',
      'STREET' => 'rua',
      'NEIGHBORHOOD' => 'bairro',
      'CITY' => 'cidade',
      'REGION' => 'região',
      _ => 'não informada',
    };

Severity? _severity(Object? value) {
  if (value is! String) return null;
  for (final s in Severity.values) {
    if (s.api == value) return s;
  }
  return null;
}

DateTime? _date(Object? value) => value is String ? DateTime.tryParse(value)?.toLocal() : null;

/// Matéria principal do alerta (a oficial, se houver; senão a mais antiga).
class NewsPrimarySource {
  const NewsPrimarySource({required this.name, required this.reliability, this.title, this.url, this.publishedAt, this.summary});

  final String name;
  final String? reliability;
  final String? title;
  final String? url;
  final DateTime? publishedAt;
  final String? summary;

  bool get isOfficial => reliability == 'OFFICIAL';

  factory NewsPrimarySource.fromJson(Map<String, dynamic> json) => NewsPrimarySource(
        name: json['name'] as String,
        reliability: json['reliability'] as String?,
        title: json['title'] as String?,
        url: json['url'] as String?,
        publishedAt: _date(json['publishedAt']),
        summary: json['summary'] as String?,
      );
}

class NewsAlert {
  const NewsAlert({
    required this.id,
    required this.code,
    required this.title,
    required this.level,
    required this.status,
    required this.severity,
    required this.locationPrecision,
    required this.articleCount,
    required this.sourceCount,
    required this.independentSources,
    required this.publishedAt,
    required this.lastEvidenceAt,
    required this.updatedAt,
    this.headline,
    this.city,
    this.regionName,
    this.placeText,
    this.point,
    this.areaRegionId,
    this.center,
    this.primarySource,
    this.reviewedByModerator = false,
    this.eventOccurredAt,
    this.expiresAt,
    this.distanceMeters,
  });

  /// Id do evento de notícia (o mesmo de `newsEventId` nas notificações).
  final String id;
  final int code;
  final String title;

  /// Consequência principal relatada pelas fontes (ex.: "via interditada").
  final String? headline;
  final NewsAlertLevel level;
  final NewsAlertStatus status;

  /// Null = a fonte não informa impacto ("gravidade não informada" — nunca "baixa").
  final Severity? severity;
  final String? city;
  final String? regionName;
  final String? placeText;
  final String locationPrecision;

  /// Só quando a fonte cita rua/local exato.
  final LatLng? point;

  /// Alerta regional: região cujo contorno é desenhado, e um ponto interno para o rótulo.
  final String? areaRegionId;
  final LatLng? center;
  final int articleCount;
  final int sourceCount;
  final int independentSources;
  final NewsPrimarySource? primarySource;
  final bool reviewedByModerator;
  final DateTime? eventOccurredAt;
  final DateTime publishedAt;
  final DateTime lastEvidenceAt;
  final DateTime updatedAt;
  final DateTime? expiresAt;
  final int? distanceMeters;

  bool get isOfficial => level == NewsAlertLevel.official;
  bool get isRegional => point == null;

  /// Onde o alerta é desenhado/tocado no mapa (ponto exato ou rótulo da área).
  LatLng? get anchor => point ?? center;

  /// "Osasco", "Lapa, São Paulo"…
  String get placeLabel {
    final parts = <String>[
      if (placeText != null && placeText!.isNotEmpty) placeText!,
      if (regionName != null && regionName != city) regionName!,
      ?city,
    ];
    return parts.isEmpty ? 'Local não informado' : parts.toSet().join(', ');
  }

  factory NewsAlert.fromJson(Map<String, dynamic> json) {
    final lat = (json['latitude'] as num?)?.toDouble();
    final lng = (json['longitude'] as num?)?.toDouble();
    final center = json['center'] as Map<String, dynamic>?;
    final primary = json['primarySource'] as Map<String, dynamic>?;
    return NewsAlert(
      id: json['id'] as String,
      code: json['code'] as int,
      title: json['title'] as String,
      headline: json['headline'] as String?,
      level: NewsAlertLevel.fromApi(json['level'] as String?),
      status: NewsAlertStatus.fromApi(json['status'] as String?),
      severity: _severity(json['severity']),
      city: json['city'] as String?,
      regionName: json['regionName'] as String?,
      placeText: json['placeText'] as String?,
      locationPrecision: json['locationPrecision'] as String? ?? 'UNKNOWN',
      point: lat != null && lng != null ? LatLng(lat, lng) : null,
      areaRegionId: json['areaRegionId'] as String?,
      center: center == null ? null : LatLng((center['latitude'] as num).toDouble(), (center['longitude'] as num).toDouble()),
      articleCount: json['articleCount'] as int? ?? 1,
      sourceCount: json['sourceCount'] as int? ?? 1,
      independentSources: json['independentSources'] as int? ?? 1,
      primarySource: primary == null ? null : NewsPrimarySource.fromJson(primary),
      reviewedByModerator: json['reviewedByModerator'] as bool? ?? false,
      eventOccurredAt: _date(json['eventOccurredAt']),
      publishedAt: _date(json['publishedAt'])!,
      lastEvidenceAt: _date(json['lastEvidenceAt'])!,
      updatedAt: _date(json['updatedAt'])!,
      expiresAt: _date(json['expiresAt']),
      distanceMeters: (json['distanceMeters'] as num?)?.round(),
    );
  }
}

/// Uma matéria que compõe o alerta.
class NewsArticleRef {
  const NewsArticleRef({required this.id, required this.title, required this.sourceName, this.reliability, this.url, this.publishedAt, this.summary, this.independent = true});

  final String id;
  final String title;
  final String sourceName;
  final String? reliability;
  final String? url;
  final DateTime? publishedAt;
  final String? summary;

  /// false = republicação ou mesma agência (não conta como confirmação independente).
  final bool independent;

  factory NewsArticleRef.fromJson(Map<String, dynamic> json) => NewsArticleRef(
        id: json['id'] as String,
        title: json['title'] as String,
        sourceName: json['sourceName'] as String,
        reliability: json['reliability'] as String?,
        url: json['url'] as String?,
        publishedAt: _date(json['publishedAt']),
        summary: json['summary'] as String?,
        independent: json['independent'] as bool? ?? true,
      );
}

class NewsAlertDetail {
  const NewsAlertDetail({required this.alert, required this.sources, this.retractionReason});

  final NewsAlert alert;
  final List<NewsArticleRef> sources;

  /// Motivo da retirada (só em alerta retirado).
  final String? retractionReason;

  factory NewsAlertDetail.fromJson(Map<String, dynamic> json) => NewsAlertDetail(
        alert: NewsAlert.fromJson(json),
        sources: ((json['sources'] as List<dynamic>?) ?? const []).map((e) => NewsArticleRef.fromJson(e as Map<String, dynamic>)).toList(),
        retractionReason: json['retractionReason'] as String?,
      );
}

/// Contorno oficial (IBGE) de uma região, para o alerta regional.
class RegionBoundary {
  const RegionBoundary({required this.regionId, required this.name, required this.polygons});

  final String regionId;
  final String name;

  /// Cada polígono: anel externo + furos.
  final List<({List<LatLng> outer, List<List<LatLng>> holes})> polygons;

  factory RegionBoundary.fromJson(Map<String, dynamic> json) {
    final geometry = json['geometry'] as Map<String, dynamic>;
    final type = geometry['type'] as String;
    final raw = geometry['coordinates'] as List<dynamic>;
    // MultiPolygon: [polígono][anel][ponto]; Polygon (tolerado): [anel][ponto].
    final polys = type == 'Polygon' ? [raw] : raw;
    List<LatLng> ring(dynamic r) => (r as List<dynamic>).map((p) {
          final c = p as List<dynamic>;
          return LatLng((c[1] as num).toDouble(), (c[0] as num).toDouble());
        }).toList();
    return RegionBoundary(
      regionId: json['regionId'] as String,
      name: json['name'] as String,
      polygons: [
        for (final p in polys)
          if ((p as List<dynamic>).isNotEmpty) (outer: ring(p.first), holes: p.skip(1).map(ring).toList()),
      ],
    );
  }
}
