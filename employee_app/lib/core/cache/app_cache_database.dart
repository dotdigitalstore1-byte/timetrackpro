import 'dart:io';

import 'package:drift/drift.dart';
import 'package:drift/native.dart';
import 'package:path/path.dart' as p;
import 'package:path_provider/path_provider.dart';

import 'key_value_cache.dart';

/// Drift (SQLite) store for cached API responses. It uses plain SQL, so the project needs no code generation.
class AppCacheDatabase extends GeneratedDatabase implements KeyValueCache {
  AppCacheDatabase(super.executor);

  /// Opens the database file in the app's support folder. The file is opened on first use, not at startup.
  factory AppCacheDatabase.open() => AppCacheDatabase(LazyDatabase(_openFile));

  static Future<QueryExecutor> _openFile() async {
    final dir = await getApplicationSupportDirectory();
    final file = File(p.join(dir.path, 'dotinout_cache.sqlite'));
    return NativeDatabase.createInBackground(file);
  }

  @override
  int get schemaVersion => 1;

  // No generated tables: the cache is one plain key-value table, created below.
  @override
  Iterable<TableInfo<Table, dynamic>> get allTables => const [];

  Future<void>? _schema;

  Future<void> _ensureSchema() {
    return _schema ??= customStatement(
      'CREATE TABLE IF NOT EXISTS cache_entries ('
      ' k TEXT NOT NULL PRIMARY KEY,'
      ' json TEXT NOT NULL,'
      ' saved_at INTEGER NOT NULL)',
    );
  }

  @override
  Future<CacheEntry?> read(String key) async {
    await _ensureSchema();
    final row = await customSelect(
      'SELECT json, saved_at FROM cache_entries WHERE k = ?',
      variables: [Variable.withString(key)],
    ).getSingleOrNull();
    if (row == null) return null;
    return CacheEntry(
      json: row.read<String>('json'),
      savedAt: DateTime.fromMillisecondsSinceEpoch(row.read<int>('saved_at')),
    );
  }

  @override
  Future<void> write(String key, String json, DateTime savedAt) async {
    await _ensureSchema();
    await customStatement(
      'INSERT OR REPLACE INTO cache_entries (k, json, saved_at) VALUES (?, ?, ?)',
      [key, json, savedAt.millisecondsSinceEpoch],
    );
  }

  @override
  Future<void> clearAll() async {
    await _ensureSchema();
    await customStatement('DELETE FROM cache_entries');
  }
}
