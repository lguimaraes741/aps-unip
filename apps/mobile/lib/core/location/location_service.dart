import 'package:geolocator/geolocator.dart';
import 'package:latlong2/latlong.dart';

enum LocationStatus { granted, denied, deniedForever, serviceDisabled, unavailable }

class LocationResult {
  const LocationResult(this.status, [this.position]);

  final LocationStatus status;
  final LatLng? position;

  bool get ok => status == LocationStatus.granted && position != null;

  String get message => switch (status) {
        LocationStatus.granted => '',
        LocationStatus.denied => 'Permissão de localização negada. Você ainda pode escolher o local no mapa.',
        LocationStatus.deniedForever =>
          'A localização está bloqueada para o AlertaCidade. Libere nas configurações do aparelho ou escolha o local no mapa.',
        LocationStatus.serviceDisabled => 'O GPS está desligado. Ative a localização do aparelho.',
        LocationStatus.unavailable => 'Não foi possível obter sua localização agora.',
      };
}

/// Acesso à localização. A permissão só é solicitada quando o usuário pede
/// (consentimento explícito — LGPD); a posição não é enviada ao servidor,
/// exceto quando faz parte de uma ocorrência ou consulta.
abstract class LocationService {
  Future<LocationResult> current({bool request = true});
  Future<bool> openSettings();
}

class GeolocatorLocationService implements LocationService {
  @override
  Future<LocationResult> current({bool request = true}) async {
    try {
      if (!await Geolocator.isLocationServiceEnabled()) return const LocationResult(LocationStatus.serviceDisabled);
      var permission = await Geolocator.checkPermission();
      if (permission == LocationPermission.denied && request) permission = await Geolocator.requestPermission();
      if (permission == LocationPermission.deniedForever) return const LocationResult(LocationStatus.deniedForever);
      if (permission == LocationPermission.denied || permission == LocationPermission.unableToDetermine) {
        return const LocationResult(LocationStatus.denied);
      }
      final p = await Geolocator.getCurrentPosition(
        locationSettings: const LocationSettings(accuracy: LocationAccuracy.high, timeLimit: Duration(seconds: 15)),
      );
      return LocationResult(LocationStatus.granted, LatLng(p.latitude, p.longitude));
    } catch (_) {
      return const LocationResult(LocationStatus.unavailable);
    }
  }

  @override
  Future<bool> openSettings() => Geolocator.openAppSettings();
}

/// Centro padrão do mapa quando a localização não está disponível (Praça da Sé, São Paulo).
const defaultMapCenter = LatLng(-23.55052, -46.63331);
