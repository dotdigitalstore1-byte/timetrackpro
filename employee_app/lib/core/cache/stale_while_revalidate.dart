import 'dart:convert';

import '../network/api_exception.dart';
import 'key_value_cache.dart';

/// What a screen shows: the data it has (from the cache or the network) and the state of the last refresh.
class Snapshot<T> {
  const Snapshot({this.data, this.savedAt, this.offline = false, this.error});

  /// The data to show, or null when nothing is cached and the network has not answered yet.
  final T? data;

  /// When [data] was fetched from the server.
  final DateTime? savedAt;

  /// The last refresh failed because there is no connection.
  final bool offline;

  /// The last refresh failed. The message is written for people.
  final String? error;

  bool get hasData => data != null;
}

/// Emits the cached copy first (when there is one), then the fresh server response.
///
/// If the refresh fails, the cached copy stays on screen and the snapshot carries the reason. The cache is only
/// replaced by a response that parses, so a bad response never wipes out good data.
Stream<Snapshot<T>> staleWhileRevalidate<T>({
  required KeyValueCache cache,
  required String key,
  required Future<Map<String, dynamic>> Function() fetch,
  required T Function(Map<String, dynamic> json) parse,
  DateTime Function() clock = DateTime.now,
}) async* {
  T? cached;
  DateTime? cachedAt;
  final entry = await _readSafely(cache, key);
  if (entry != null) {
    final value = _parseCached(entry.json, parse);
    if (value != null) {
      cached = value;
      cachedAt = entry.savedAt;
      yield Snapshot<T>(data: cached, savedAt: cachedAt);
    }
  }
  yield await _refresh<T>(
    cache: cache,
    key: key,
    fetch: fetch,
    parse: parse,
    clock: clock,
    cached: cached,
    cachedAt: cachedAt,
  );
}

Future<Snapshot<T>> _refresh<T>({
  required KeyValueCache cache,
  required String key,
  required Future<Map<String, dynamic>> Function() fetch,
  required T Function(Map<String, dynamic> json) parse,
  required DateTime Function() clock,
  required T? cached,
  required DateTime? cachedAt,
}) async {
  try {
    final json = await fetch();
    final fresh = parse(json);
    try {
      await cache.write(key, jsonEncode(json), clock());
    } catch (_) {
      // A failed cache write only costs the instant start next time. The fresh data still shows now.
    }
    return Snapshot<T>(data: fresh, savedAt: clock());
  } on ApiException catch (e) {
    return Snapshot<T>(data: cached, savedAt: cachedAt, offline: e.offline, error: e.message);
  } catch (_) {
    return Snapshot<T>(data: cached, savedAt: cachedAt, error: 'Could not read the data from the server.');
  }
}

Future<CacheEntry?> _readSafely(KeyValueCache cache, String key) async {
  try {
    return await cache.read(key);
  } catch (_) {
    return null;
  }
}

T? _parseCached<T>(String json, T Function(Map<String, dynamic>) parse) {
  try {
    final decoded = jsonDecode(json);
    if (decoded is! Map<String, dynamic>) return null;
    return parse(decoded);
  } catch (_) {
    return null;
  }
}
