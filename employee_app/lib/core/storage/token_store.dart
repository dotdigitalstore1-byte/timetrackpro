import 'package:flutter_secure_storage/flutter_secure_storage.dart';

/// Keeps the session token and the signed-in user's id in the platform's secure storage (Keychain on iOS, encrypted
/// preferences on Android). The user id scopes the offline cache, so one user's data is never shown to another.
class TokenStore {
  TokenStore([FlutterSecureStorage? storage])
      : _storage = storage ??
            const FlutterSecureStorage(
              aOptions: AndroidOptions(encryptedSharedPreferences: true),
              iOptions: IOSOptions(accessibility: KeychainAccessibility.first_unlock_this_device),
            );

  static const _tokenKey = 'dotinout.session_token';
  static const _userKey = 'dotinout.user_id';

  final FlutterSecureStorage _storage;

  Future<String?> read() => _storage.read(key: _tokenKey);

  Future<void> write(String token) => _storage.write(key: _tokenKey, value: token);

  Future<String?> readUserId() => _storage.read(key: _userKey);

  Future<void> writeUserId(String id) => _storage.write(key: _userKey, value: id);

  /// Removes the token and the user id together.
  Future<void> clear() async {
    await _storage.delete(key: _tokenKey);
    await _storage.delete(key: _userKey);
  }
}
