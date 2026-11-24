import '../../../core/network/api_client.dart';
import '../../../core/network/api_exception.dart';
import '../../../core/storage/token_store.dart';

/// Result of a successful employee sign-in.
class SignedInUser {
  const SignedInUser({required this.role, required this.home});

  final String role;
  final String home;
}

/// The signed-in user's identity. The full employee profile comes from the Profile screen's own call.
class CurrentUser {
  const CurrentUser({required this.id, required this.fullName, required this.role});

  final String id;
  final String fullName;
  final String role;
}

class AuthRepository {
  AuthRepository(this._api, this._tokens);

  final ApiClient _api;
  final TokenStore _tokens;

  /// Signs in an employee. The server refuses every other role for the mobile app, with the same message the web gives.
  Future<SignedInUser> signIn({required String identifier, required String password}) async {
    final json = await _api.postJson(
      '/api/mobile/auth/login',
      body: {'identifier': identifier.trim(), 'password': password},
      authenticated: false,
    );
    final token = json['token'];
    if (token is! String || token.isEmpty) {
      throw const ApiException('Sign-in failed. Please try again.');
    }
    // Forget any previous account's token and user id before storing the new one.
    await _tokens.clear();
    await _tokens.write(token);
    return SignedInUser(
      role: (json['role'] as String?) ?? 'employee',
      home: (json['home'] as String?) ?? '/dashboard',
    );
  }

  /// Fetches the signed-in user and remembers their id for the offline cache.
  /// Throws [ApiException] with `unauthorized` set when the token is no longer valid.
  Future<CurrentUser> currentUser() async {
    final json = await _api.getJson('/api/auth/me');
    final user = json['user'];
    if (user is! Map || user['id'] is! String) {
      throw const ApiException('Could not load your profile. Please try again.');
    }
    final id = user['id'] as String;
    await _tokens.writeUserId(id);
    return CurrentUser(
      id: id,
      fullName: (user['fullName'] as String?) ?? '',
      role: (user['role'] as String?) ?? 'employee',
    );
  }

  /// Signs out on the server (which revokes the session) and always clears the local token, even if the call fails.
  Future<void> signOut() async {
    try {
      await _api.postJson('/api/auth/logout');
    } on ApiException {
      // Best effort: the local token is removed below either way.
    } finally {
      await _tokens.clear();
    }
  }

  Future<String?> storedToken() => _tokens.read();

  Future<String?> storedUserId() => _tokens.readUserId();

  Future<void> clearToken() => _tokens.clear();
}
