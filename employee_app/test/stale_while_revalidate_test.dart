import 'package:flutter_test/flutter_test.dart';

import 'package:dotinout_employee/core/cache/key_value_cache.dart';
import 'package:dotinout_employee/core/cache/stale_while_revalidate.dart';
import 'package:dotinout_employee/core/network/api_exception.dart';

class _MemoryCache implements KeyValueCache {
  final Map<String, CacheEntry> store = {};

  @override
  Future<CacheEntry?> read(String key) async => store[key];

  @override
  Future<void> write(String key, String json, DateTime savedAt) async {
    store[key] = CacheEntry(json: json, savedAt: savedAt);
  }

  @override
  Future<void> clearAll() async => store.clear();
}

int _parse(Map<String, dynamic> json) => json['v'] as int;

final _savedBefore = DateTime.utc(2026, 11, 23, 9);
final _now = DateTime.utc(2026, 11, 23, 10);
DateTime _clock() => _now;

Future<List<Snapshot<int>>> _run({
  required KeyValueCache cache,
  required Future<Map<String, dynamic>> Function() fetch,
}) {
  return staleWhileRevalidate<int>(
    cache: cache,
    key: 'k',
    fetch: fetch,
    parse: _parse,
    clock: _clock,
  ).toList();
}

void main() {
  test('with nothing cached, shows only the fresh response', () async {
    final cache = _MemoryCache();
    final out = await _run(cache: cache, fetch: () async => {'v': 2});

    expect(out, hasLength(1));
    expect(out.single.data, 2);
    expect(out.single.error, isNull);
    expect(cache.store['k']?.json, '{"v":2}');
  });

  test('shows the cached copy first, then replaces it with the fresh one', () async {
    final cache = _MemoryCache()..store['k'] = CacheEntry(json: '{"v":1}', savedAt: _savedBefore);
    final out = await _run(cache: cache, fetch: () async => {'v': 2});

    expect(out, hasLength(2));
    expect(out.first.data, 1);
    expect(out.first.savedAt, _savedBefore);
    expect(out.last.data, 2);
    expect(out.last.error, isNull);
    expect(cache.store['k']?.json, '{"v":2}');
  });

  test('offline keeps the cached copy on screen and says so', () async {
    final cache = _MemoryCache()..store['k'] = CacheEntry(json: '{"v":1}', savedAt: _savedBefore);
    final out = await _run(
      cache: cache,
      fetch: () async => throw const ApiException('No internet connection.', offline: true),
    );

    expect(out, hasLength(2));
    expect(out.last.data, 1);
    expect(out.last.offline, isTrue);
    expect(out.last.error, 'No internet connection.');
    expect(out.last.savedAt, _savedBefore);
    expect(cache.store['k']?.json, '{"v":1}', reason: 'a failed refresh must not overwrite good data');
  });

  test('offline with nothing cached has no data to show, only the reason', () async {
    final out = await _run(
      cache: _MemoryCache(),
      fetch: () async => throw const ApiException('No internet connection.', offline: true),
    );

    expect(out, hasLength(1));
    expect(out.single.hasData, isFalse);
    expect(out.single.offline, isTrue);
    expect(out.single.error, isNotNull);
  });

  test('a response that does not parse never replaces the cache', () async {
    final cache = _MemoryCache()..store['k'] = CacheEntry(json: '{"v":1}', savedAt: _savedBefore);
    final out = await _run(cache: cache, fetch: () async => {'v': 'not a number'});

    expect(out.last.data, 1);
    expect(out.last.error, 'Could not read the data from the server.');
    expect(cache.store['k']?.json, '{"v":1}');
  });

  test('an unreadable cache entry is ignored, and the network answer still shows', () async {
    final cache = _MemoryCache()..store['k'] = CacheEntry(json: 'not json', savedAt: _savedBefore);
    final out = await _run(cache: cache, fetch: () async => {'v': 3});

    expect(out, hasLength(1));
    expect(out.single.data, 3);
  });
}
