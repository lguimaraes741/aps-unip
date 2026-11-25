/// Modelos de domínio — espelham os contratos da API (`packages/shared-types`).
library;

enum Severity {
  low('LOW', 'Baixa'),
  moderate('MODERATE', 'Moderada'),
  high('HIGH', 'Alta'),
  critical('CRITICAL', 'Crítica');

  const Severity(this.api, this.label);
  final String api;
  final String label;

  static Severity fromApi(String value) =>
      Severity.values.firstWhere((s) => s.api == value, orElse: () => throw FormatException('Gravidade desconhecida: $value'));
}

enum OccurrenceStatus {
  pending('PENDING', 'Pendente'),
  underReview('UNDER_REVIEW', 'Em análise'),
  validated('VALIDATED', 'Validada'),
  rejected('REJECTED', 'Rejeitada'),
  resolved('RESOLVED', 'Resolvida');

  const OccurrenceStatus(this.api, this.label);
  final String api;
  final String label;

  static OccurrenceStatus fromApi(String value) => OccurrenceStatus.values
      .firstWhere((s) => s.api == value, orElse: () => throw FormatException('Status desconhecido: $value'));
}

enum ConfirmationType {
  confirm('CONFIRM'),
  contest('CONTEST');

  const ConfirmationType(this.api);
  final String api;

  static ConfirmationType? fromApi(String? value) =>
      value == null ? null : ConfirmationType.values.firstWhere((c) => c.api == value);
}

enum UserRole {
  citizen('CITIZEN', 'Cidadão'),
  moderator('MODERATOR', 'Moderador'),
  admin('ADMIN', 'Administrador');

  const UserRole(this.api, this.label);
  final String api;
  final String label;

  static UserRole fromApi(String value) => UserRole.values.firstWhere((r) => r.api == value, orElse: () => citizen);
}

DateTime _date(Object? v) => DateTime.parse(v as String).toUtc();
DateTime? _dateOrNull(Object? v) => v == null ? null : _date(v);
double _double(Object? v) => (v as num).toDouble();

class UserProfile {
  const UserProfile({required this.id, required this.name, required this.email, required this.role});

  final String id;
  final String name;
  final String email;
  final UserRole role;

  String get firstName => name.split(' ').first;

  String get initials {
    final parts = name.trim().split(RegExp(r'\s+')).where((p) => p.isNotEmpty).toList();
    if (parts.isEmpty) return '?';
    return (parts.first[0] + (parts.length > 1 ? parts.last[0] : '')).toUpperCase();
  }

  factory UserProfile.fromJson(Map<String, dynamic> json) => UserProfile(
        id: json['id'] as String,
        name: json['name'] as String,
        email: json['email'] as String,
        role: UserRole.fromApi(json['role'] as String),
      );

  Map<String, dynamic> toJson() => {'id': id, 'name': name, 'email': email, 'role': role.api};
}

/// Item de lista (mapa, meus registros).
class OccurrenceSummary {
  const OccurrenceSummary({
    required this.id,
    required this.code,
    required this.title,
    required this.address,
    required this.neighborhood,
    required this.latitude,
    required this.longitude,
    required this.severity,
    required this.status,
    required this.occurredAt,
    required this.createdAt,
    required this.updatedAt,
    required this.confirmCount,
    required this.contestCount,
    required this.coverPhotoUrl,
    required this.distanceMeters,
    required this.isDemo,
  });

  final String id;
  final int code;
  final String title;
  final String address;
  final String? neighborhood;
  final double latitude;
  final double longitude;
  final Severity severity;
  final OccurrenceStatus status;
  final DateTime occurredAt;
  final DateTime createdAt;
  final DateTime updatedAt;
  final int confirmCount;
  final int contestCount;
  final String? coverPhotoUrl;
  final int? distanceMeters;
  final bool isDemo;

  factory OccurrenceSummary.fromJson(Map<String, dynamic> json) => OccurrenceSummary(
        id: json['id'] as String,
        code: json['code'] as int,
        title: json['title'] as String,
        address: json['address'] as String,
        neighborhood: json['neighborhood'] as String?,
        latitude: _double(json['latitude']),
        longitude: _double(json['longitude']),
        severity: Severity.fromApi(json['severity'] as String),
        status: OccurrenceStatus.fromApi(json['status'] as String),
        occurredAt: _date(json['occurredAt']),
        createdAt: _date(json['createdAt']),
        updatedAt: _date(json['updatedAt'] ?? json['createdAt']),
        confirmCount: json['confirmCount'] as int,
        contestCount: json['contestCount'] as int,
        coverPhotoUrl: json['coverPhotoUrl'] as String?,
        distanceMeters: (json['distanceMeters'] as num?)?.round(),
        isDemo: json['isDemo'] as bool? ?? false,
      );
}

class OccurrencePhoto {
  const OccurrencePhoto({required this.id, required this.url, this.width, this.height});

  final String id;
  final String url;
  final int? width;
  final int? height;

  factory OccurrencePhoto.fromJson(Map<String, dynamic> json) => OccurrencePhoto(
        id: json['id'] as String,
        url: json['url'] as String,
        width: json['width'] as int?,
        height: json['height'] as int?,
      );
}

class TimelineEntry {
  const TimelineEntry({required this.fromStatus, required this.toStatus, required this.note, required this.createdAt, required this.byModeration});

  final OccurrenceStatus? fromStatus;
  final OccurrenceStatus toStatus;
  final String? note;
  final DateTime createdAt;
  final bool byModeration;

  factory TimelineEntry.fromJson(Map<String, dynamic> json) => TimelineEntry(
        fromStatus: json['fromStatus'] == null ? null : OccurrenceStatus.fromApi(json['fromStatus'] as String),
        toStatus: OccurrenceStatus.fromApi(json['toStatus'] as String),
        note: json['note'] as String?,
        createdAt: _date(json['createdAt']),
        byModeration: json['actor'] == 'MODERATION',
      );
}

class OccurrenceDetail {
  const OccurrenceDetail({
    required this.id,
    required this.code,
    required this.title,
    required this.description,
    required this.address,
    required this.neighborhood,
    required this.latitude,
    required this.longitude,
    required this.severity,
    required this.status,
    required this.occurredAt,
    required this.createdAt,
    required this.resolvedAt,
    required this.confirmCount,
    required this.contestCount,
    required this.isDemo,
    required this.isMine,
    required this.isSaved,
    required this.myConfirmation,
    required this.distanceMeters,
    required this.reporterFirstName,
    required this.moderationNote,
    required this.photos,
    required this.history,
  });

  final String id;
  final int code;
  final String title;
  final String description;
  final String address;
  final String? neighborhood;
  final double latitude;
  final double longitude;
  final Severity severity;
  final OccurrenceStatus status;
  final DateTime occurredAt;
  final DateTime createdAt;
  final DateTime? resolvedAt;
  final int confirmCount;
  final int contestCount;
  final bool isDemo;
  final bool isMine;
  final bool isSaved;
  final ConfirmationType? myConfirmation;
  final int? distanceMeters;
  final String? reporterFirstName;
  final String? moderationNote;
  final List<OccurrencePhoto> photos;
  final List<TimelineEntry> history;

  bool get acceptsConfirmation =>
      !isMine && (status == OccurrenceStatus.pending || status == OccurrenceStatus.underReview || status == OccurrenceStatus.validated);

  factory OccurrenceDetail.fromJson(Map<String, dynamic> json) => OccurrenceDetail(
        id: json['id'] as String,
        code: json['code'] as int,
        title: json['title'] as String,
        description: json['description'] as String,
        address: json['address'] as String,
        neighborhood: json['neighborhood'] as String?,
        latitude: _double(json['latitude']),
        longitude: _double(json['longitude']),
        severity: Severity.fromApi(json['severity'] as String),
        status: OccurrenceStatus.fromApi(json['status'] as String),
        occurredAt: _date(json['occurredAt']),
        createdAt: _date(json['createdAt']),
        resolvedAt: _dateOrNull(json['resolvedAt']),
        confirmCount: json['confirmCount'] as int,
        contestCount: json['contestCount'] as int,
        isDemo: json['isDemo'] as bool? ?? false,
        isMine: json['isMine'] as bool? ?? false,
        isSaved: json['isSaved'] as bool? ?? false,
        myConfirmation: ConfirmationType.fromApi(json['myConfirmation'] as String?),
        distanceMeters: (json['distanceMeters'] as num?)?.round(),
        reporterFirstName: (json['reporter'] as Map<String, dynamic>?)?['firstName'] as String?,
        moderationNote: json['moderationNote'] as String?,
        photos: (json['photos'] as List<dynamic>? ?? [])
            .map((p) => OccurrencePhoto.fromJson(p as Map<String, dynamic>))
            .toList(),
        history: (json['history'] as List<dynamic>? ?? [])
            .map((h) => TimelineEntry.fromJson(h as Map<String, dynamic>))
            .toList(),
      );

  OccurrenceDetail copyWith({int? confirmCount, int? contestCount, ConfirmationType? Function()? myConfirmation, bool? isSaved}) =>
      OccurrenceDetail(
        id: id,
        code: code,
        title: title,
        description: description,
        address: address,
        neighborhood: neighborhood,
        latitude: latitude,
        longitude: longitude,
        severity: severity,
        status: status,
        occurredAt: occurredAt,
        createdAt: createdAt,
        resolvedAt: resolvedAt,
        confirmCount: confirmCount ?? this.confirmCount,
        contestCount: contestCount ?? this.contestCount,
        isDemo: isDemo,
        isMine: isMine,
        isSaved: isSaved ?? this.isSaved,
        myConfirmation: myConfirmation != null ? myConfirmation() : this.myConfirmation,
        distanceMeters: distanceMeters,
        reporterFirstName: reporterFirstName,
        moderationNote: moderationNote,
        photos: photos,
        history: history,
      );
}

class Paged<T> {
  const Paged({required this.items, required this.total, required this.page, required this.limit});

  final List<T> items;
  final int total;
  final int page;
  final int limit;

  bool get hasMore => page * limit < total;

  factory Paged.fromJson(Map<String, dynamic> json, T Function(Map<String, dynamic>) parse) => Paged(
        items: (json['items'] as List<dynamic>).map((e) => parse(e as Map<String, dynamic>)).toList(),
        total: json['total'] as int,
        page: json['page'] as int,
        limit: json['limit'] as int,
      );
}

class MySummary {
  const MySummary({required this.total, required this.active, required this.pending, required this.resolved});

  final int total;
  final int active;
  final int pending;
  final int resolved;

  factory MySummary.fromJson(Map<String, dynamic> json) => MySummary(
        total: json['total'] as int,
        active: json['active'] as int,
        pending: json['pending'] as int,
        resolved: json['resolved'] as int,
      );
}

class NotificationPreferences {
  const NotificationPreferences({
    required this.pushEnabled,
    required this.radiusMeters,
    required this.minSeverity,
    this.latitude,
    this.longitude,
  });

  final bool pushEnabled;
  final int radiusMeters;
  final Severity minSeverity;
  final double? latitude;
  final double? longitude;

  bool get hasArea => latitude != null && longitude != null;

  factory NotificationPreferences.fromJson(Map<String, dynamic> json) => NotificationPreferences(
        pushEnabled: json['pushEnabled'] as bool,
        radiusMeters: json['radiusMeters'] as int,
        minSeverity: Severity.fromApi(json['minSeverity'] as String),
        latitude: (json['latitude'] as num?)?.toDouble(),
        longitude: (json['longitude'] as num?)?.toDouble(),
      );

  Map<String, dynamic> toJson() => {
        'pushEnabled': pushEnabled,
        'radiusMeters': radiusMeters,
        'minSeverity': minSeverity.api,
        'latitude': latitude,
        'longitude': longitude,
      };

  NotificationPreferences copyWith({bool? pushEnabled, int? radiusMeters, Severity? minSeverity, double? latitude, double? longitude, bool clearArea = false}) =>
      NotificationPreferences(
        pushEnabled: pushEnabled ?? this.pushEnabled,
        radiusMeters: radiusMeters ?? this.radiusMeters,
        minSeverity: minSeverity ?? this.minSeverity,
        latitude: clearArea ? null : latitude ?? this.latitude,
        longitude: clearArea ? null : longitude ?? this.longitude,
      );
}

// ---------------------------------------------------------------------------
// Fase 4 — alertas e tempo real
// ---------------------------------------------------------------------------

enum NotificationKind {
  nearby('OCCURRENCE_NEARBY'),
  statusChanged('OCCURRENCE_STATUS_CHANGED'),
  /// Alerta identificado em notícias (Fase 7) — não é comunicado oficial.
  newsAlert('NEWS_ALERT'),
  /// Atualização de um alerta de notícia já recebido (encerrado, corrigido ou desmentido).
  newsAlertUpdate('NEWS_ALERT_UPDATE'),
  /// Só moderação: notícia aguardando revisão urgente (ainda não publicada para o público).
  newsReviewUrgent('NEWS_REVIEW_URGENT'),
  /// Tipo criado numa versão futura do servidor: o alerta aparece, sem ação específica.
  other('');

  const NotificationKind(this.api);
  final String api;

  bool get isNews => this == newsAlert || this == newsAlertUpdate || this == newsReviewUrgent;

  /// Nunca lança: um tipo novo no servidor não pode derrubar a caixa de alertas inteira.
  static NotificationKind fromApi(String value) =>
      NotificationKind.values.firstWhere((k) => k.api == value && k != other, orElse: () => other);
}

/// Filtros da caixa de alertas — aplicados pela API (o estado ATUAL da ocorrência conta).
enum NotificationFilter {
  all('all', 'Todos'),
  unread('unread', 'Não lidos'),
  critical('critical', 'Críticos'),
  nearby('nearby', 'Próximos'),
  resolved('resolved', 'Resolvidos');

  const NotificationFilter(this.api, this.label);
  final String api;
  final String label;
}

/// Estado atual da ocorrência do alerta (null = ela foi removida).
class NotificationOccurrence {
  const NotificationOccurrence({required this.code, required this.severity, required this.status});

  final int code;
  final Severity severity;
  final OccurrenceStatus status;

  factory NotificationOccurrence.fromJson(Map<String, dynamic> json) => NotificationOccurrence(
        code: json['code'] as int,
        severity: Severity.fromApi(json['severity'] as String),
        status: OccurrenceStatus.fromApi(json['status'] as String),
      );
}

class AppNotification {
  const AppNotification({
    required this.id,
    required this.kind,
    required this.occurrenceId,
    this.newsEventId,
    required this.title,
    required this.body,
    required this.distanceMeters,
    required this.occurrence,
    required this.readAt,
    required this.createdAt,
  });

  final String id;
  final NotificationKind kind;
  final String? occurrenceId;
  final String? newsEventId;
  final String title;
  final String body;
  final int? distanceMeters;
  final NotificationOccurrence? occurrence;
  final DateTime? readAt;
  final DateTime createdAt;

  bool get unread => readAt == null;

  factory AppNotification.fromJson(Map<String, dynamic> json) => AppNotification(
        id: json['id'] as String,
        kind: NotificationKind.fromApi(json['type'] as String),
        occurrenceId: json['occurrenceId'] as String?,
        newsEventId: json['newsEventId'] as String?,
        title: json['title'] as String,
        body: json['body'] as String,
        distanceMeters: json['distanceMeters'] as int?,
        occurrence: json['occurrence'] == null ? null : NotificationOccurrence.fromJson(json['occurrence'] as Map<String, dynamic>),
        readAt: _dateOrNull(json['readAt']),
        createdAt: _date(json['createdAt']),
      );

  AppNotification markedRead(DateTime at) => AppNotification(
        id: id,
        kind: kind,
        occurrenceId: occurrenceId,
        newsEventId: newsEventId,
        title: title,
        body: body,
        distanceMeters: distanceMeters,
        occurrence: occurrence,
        readAt: readAt ?? at,
        createdAt: createdAt,
      );
}

class NotificationsPage {
  const NotificationsPage({required this.page, required this.unread});

  final Paged<AppNotification> page;

  /// Total de não lidas (independente do filtro) — badge da aba Alertas.
  final int unread;

  factory NotificationsPage.fromJson(Map<String, dynamic> json) =>
      NotificationsPage(page: Paged.fromJson(json, AppNotification.fromJson), unread: json['unread'] as int);
}

/// Evento de domínio recebido pelo Socket.IO ou por `GET /sync`.
///
/// O tipo fica como texto: um tipo novo no servidor (versão futura) não derruba o app —
/// ele apenas recarrega os dados afetados.
class DomainEvent {
  const DomainEvent({required this.eventId, required this.sequence, required this.type, required this.occurrenceId, this.newsEventId});

  final String eventId;

  /// Cursor de entrega (`published_sequence`): cresce na ordem de publicação.
  final BigInt sequence;
  final String type;

  /// Null em eventos que não são de ocorrência (ex.: `news.alert.*`, Fase 7).
  final String? occurrenceId;

  /// Evento de notícia afetado (`news.alert.*`).
  final String? newsEventId;

  bool get isNews => type.startsWith('news.');

  factory DomainEvent.fromJson(Map<String, dynamic> json) {
    final payload = (json['payload'] as Map<String, dynamic>?) ?? const {};
    return DomainEvent(
      eventId: json['eventId'] as String,
      sequence: BigInt.parse(json['sequence'] as String),
      type: json['type'] as String,
      occurrenceId: payload['occurrenceId'] as String?,
      newsEventId: payload['eventId'] as String?,
    );
  }
}

class SyncResult {
  const SyncResult({required this.events, required this.cursor, required this.hasMore, required this.reset});

  final List<DomainEvent> events;
  final BigInt cursor;
  final bool hasMore;

  /// O cursor do cliente é maior que o do servidor (banco recriado): recarregar tudo.
  final bool reset;

  factory SyncResult.fromJson(Map<String, dynamic> json) => SyncResult(
        events: (json['events'] as List<dynamic>).map((e) => DomainEvent.fromJson(e as Map<String, dynamic>)).toList(),
        cursor: BigInt.parse(json['cursor'] as String),
        hasMore: json['hasMore'] as bool,
        reset: json['reset'] as bool? ?? false,
      );
}
