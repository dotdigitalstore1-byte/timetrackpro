/// The last good response a screen received, with the time it was saved.
class CacheEntry {
  const CacheEntry({required this.json, required this.savedAt});

  final String json;
  final DateTime savedAt;
}

/// Local storage for API responses. Keys are scoped per signed-in user (see the employee providers).
abstract class KeyValueCache {
  Future<CacheEntry?> read(String key);

  Future<void> write(String key, String json, DateTime savedAt);

  /// Removes everything. Called on sign-out, so a shared device keeps no one's data.
  Future<void> clearAll();
}

/// Used when the user is not known yet. Nothing is kept, so nothing can leak between accounts.
class NoCache implements KeyValueCache {
  const NoCache();

  @override
  Future<CacheEntry?> read(String key) async => null;

  @override
  Future<void> write(String key, String json, DateTime savedAt) async {}

  @override
  Future<void> clearAll() async {}
}
