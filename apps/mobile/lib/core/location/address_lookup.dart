import 'package:flutter_riverpod/flutter_riverpod.dart';
import 'package:geocoding/geocoding.dart';
import 'package:material_ui/material_ui.dart';

/// Endereço aproximado de uma coordenada, para pré-preencher o registro (o usuário confere e ajusta).
class ResolvedAddress {
  const ResolvedAddress({required this.address, this.neighborhood});

  final String address;
  final String? neighborhood;
}

/// Converte coordenadas em endereço (geocodificação reversa).
abstract interface class AddressLookup {
  /// `null` quando não há serviço, rede ou resultado — o app pede para digitar.
  Future<ResolvedAddress?> fromCoordinates(double latitude, double longitude);
}

/// Usa o serviço de endereços do próprio Android (sem chave e sem servidor nosso).
class DeviceAddressLookup implements AddressLookup {
  DeviceAddressLookup() : _geocoding = Geocoding(locale: const Locale('pt', 'BR'));

  final Geocoding _geocoding;

  @override
  Future<ResolvedAddress?> fromCoordinates(double latitude, double longitude) async {
    try {
      if (!await _geocoding.isPresent()) return null;
      final places = await _geocoding
          .placemarkFromCoordinates(latitude, longitude)
          .timeout(const Duration(seconds: 8));
      if (places.isEmpty) return null;
      return describe(
        thoroughfare: places.first.thoroughfare,
        number: places.first.subThoroughfare,
        street: places.first.street,
        name: places.first.name,
        subLocality: places.first.subLocality,
      );
    } catch (_) {
      return null;
    }
  }

  /// Monta "Rua X, 123" e o bairro a partir dos campos do serviço (que variam por aparelho).
  static ResolvedAddress? describe({
    String? thoroughfare,
    String? number,
    String? street,
    String? name,
    String? subLocality,
  }) {
    String? clean(String? s) => (s == null || s.trim().isEmpty) ? null : s.trim();
    final road = clean(thoroughfare);
    final no = clean(number);
    // Alguns aparelhos devolvem "Unnamed Road"/coordenadas em `street`; números puros não servem de endereço.
    bool useful(String? s) => s != null && !RegExp(r'^[\d\s,.+-]+$').hasMatch(s) && !s.toLowerCase().contains('unnamed');
    final address = road != null
        ? (no != null && RegExp(r'\d').hasMatch(no) ? '$road, $no' : road)
        : [clean(street), clean(name)].firstWhere(useful, orElse: () => null);
    if (address == null || address.length < 3) return null;
    final neighborhood = clean(subLocality);
    return ResolvedAddress(
      address: address.length > 255 ? address.substring(0, 255) : address,
      neighborhood: neighborhood == null ? null : (neighborhood.length > 120 ? neighborhood.substring(0, 120) : neighborhood),
    );
  }
}

final addressLookupProvider = Provider<AddressLookup>((ref) => DeviceAddressLookup());
