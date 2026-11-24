/// Forgiving readers for the server's JSON. Numbers can arrive as numbers or as strings (decimal columns), and any
/// field can be missing, so every read falls back to a safe value instead of throwing.

Map<String, dynamic> readMap(Object? v) => v is Map ? Map<String, dynamic>.from(v) : <String, dynamic>{};

List<Map<String, dynamic>> readList(Object? v) {
  if (v is! List) return <Map<String, dynamic>>[];
  return v.whereType<Map>().map((e) => Map<String, dynamic>.from(e)).toList();
}

String? readString(Object? v) => v is String ? v : null;

String readStringOr(Object? v, String fallback) => v is String ? v : fallback;

int readInt(Object? v) {
  if (v is num) return v.toInt();
  if (v is String) return int.tryParse(v) ?? 0;
  return 0;
}

double readNum(Object? v) {
  if (v is num) return v.toDouble();
  if (v is String) return double.tryParse(v) ?? 0;
  return 0;
}

double? readNumOrNull(Object? v) => v == null ? null : readNum(v);

int? readIntOrNull(Object? v) => v == null ? null : readInt(v);

bool readBool(Object? v) => v == true;

/// "2026-11-23T00:00:00.000Z" or "2026-11-23" becomes "2026-11-23". Anything else returns null.
String? dateKeyOf(Object? v) {
  if (v is! String || v.length < 10) return null;
  return v.substring(0, 10);
}

/// Instants (punch times, timestamps) are shown in the device's local time.
DateTime? instantOf(Object? v) => v is String ? DateTime.tryParse(v)?.toLocal() : null;
