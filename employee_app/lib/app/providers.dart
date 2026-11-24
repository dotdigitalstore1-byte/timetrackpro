import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../core/cache/app_cache_database.dart';
import '../core/cache/key_value_cache.dart';
import '../core/network/api_client.dart';
import '../core/storage/token_store.dart';
import '../features/auth/application/session_controller.dart';
import '../features/auth/data/auth_repository.dart';

final tokenStoreProvider = Provider<TokenStore>((ref) => TokenStore());

final apiClientProvider = Provider<ApiClient>((ref) {
  return ApiClient(
    tokens: ref.watch(tokenStoreProvider),
    onUnauthorized: () => ref.read(sessionProvider.notifier).expire(),
  );
});

final authRepositoryProvider = Provider<AuthRepository>((ref) {
  return AuthRepository(ref.watch(apiClientProvider), ref.watch(tokenStoreProvider));
});

/// The offline cache (Drift/SQLite). Opened on first use and closed when the app's scope ends.
final cacheProvider = Provider<KeyValueCache>((ref) {
  final db = AppCacheDatabase.open();
  ref.onDispose(db.close);
  return db;
});
