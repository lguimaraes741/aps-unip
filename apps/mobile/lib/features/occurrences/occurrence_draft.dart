import 'dart:convert';

import 'package:shared_preferences/shared_preferences.dart';
import 'package:uuid/uuid.dart';

import '../../domain/models.dart';

/// Rascunho do formulário de nova ocorrência, salvo localmente para evitar perda
/// por navegação acidental, fechamento do app ou falha de rede.
/// O `clientRequestId` acompanha o rascunho: reenviar após uma falha não duplica o registro.
class OccurrenceDraft {
  OccurrenceDraft({
    String? clientRequestId,
    this.title = '',
    this.description = '',
    this.address = '',
    this.neighborhood = '',
    this.latitude,
    this.longitude,
    this.severity,
    DateTime? occurredAt,
    List<String>? photoPaths,
    this.createdOccurrenceId,
    List<String>? uploadedPhotoPaths,
  })  : clientRequestId = clientRequestId ?? const Uuid().v4(),
        occurredAt = occurredAt ?? DateTime.now(),
        photoPaths = photoPaths ?? [],
        uploadedPhotoPaths = uploadedPhotoPaths ?? [];

  final String clientRequestId;
  String title;
  String description;
  String address;
  String neighborhood;
  double? latitude;
  double? longitude;
  Severity? severity;
  DateTime occurredAt;
  List<String> photoPaths;

  /// Preenchido quando a ocorrência já foi criada mas alguma foto falhou.
  String? createdOccurrenceId;
  List<String> uploadedPhotoPaths;

  bool get hasLocation => latitude != null && longitude != null;

  /// O que só o usuário informa. Local, endereço e bairro podem vir sozinhos do GPS,
  /// então abrir e fechar a tela não conta como rascunho.
  bool get hasUserContent =>
      title.trim().isNotEmpty || description.trim().isNotEmpty || severity != null || photoPaths.isNotEmpty;

  bool get isEmpty =>
      title.trim().isEmpty && description.trim().isEmpty && address.trim().isEmpty && !hasLocation && severity == null && photoPaths.isEmpty;

  List<String> get pendingPhotos => photoPaths.where((p) => !uploadedPhotoPaths.contains(p)).toList();

  Map<String, dynamic> toJson() => {
        'clientRequestId': clientRequestId,
        'title': title,
        'description': description,
        'address': address,
        'neighborhood': neighborhood,
        'latitude': latitude,
        'longitude': longitude,
        'severity': severity?.api,
        'occurredAt': occurredAt.toUtc().toIso8601String(),
        'photoPaths': photoPaths,
        'createdOccurrenceId': createdOccurrenceId,
        'uploadedPhotoPaths': uploadedPhotoPaths,
      };

  factory OccurrenceDraft.fromJson(Map<String, dynamic> json) => OccurrenceDraft(
        clientRequestId: json['clientRequestId'] as String?,
        title: json['title'] as String? ?? '',
        description: json['description'] as String? ?? '',
        address: json['address'] as String? ?? '',
        neighborhood: json['neighborhood'] as String? ?? '',
        latitude: (json['latitude'] as num?)?.toDouble(),
        longitude: (json['longitude'] as num?)?.toDouble(),
        severity: json['severity'] == null ? null : Severity.fromApi(json['severity'] as String),
        occurredAt: json['occurredAt'] == null ? null : DateTime.parse(json['occurredAt'] as String).toLocal(),
        photoPaths: (json['photoPaths'] as List<dynamic>? ?? []).cast<String>(),
        createdOccurrenceId: json['createdOccurrenceId'] as String?,
        uploadedPhotoPaths: (json['uploadedPhotoPaths'] as List<dynamic>? ?? []).cast<String>(),
      );
}

class DraftStore {
  static const _key = 'alertacidade.draft.new_occurrence';

  Future<OccurrenceDraft?> load() async {
    final prefs = await SharedPreferences.getInstance();
    final raw = prefs.getString(_key);
    if (raw == null) return null;
    try {
      return OccurrenceDraft.fromJson(jsonDecode(raw) as Map<String, dynamic>);
    } catch (_) {
      await prefs.remove(_key);
      return null;
    }
  }

  Future<void> save(OccurrenceDraft draft) async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.setString(_key, jsonEncode(draft.toJson()));
  }

  Future<void> clear() async {
    final prefs = await SharedPreferences.getInstance();
    await prefs.remove(_key);
  }
}
