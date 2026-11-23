import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../../../core/network/api_exception.dart';
import '../data/auth_repository.dart';

enum SessionStatus { unknown, signedOut, signedIn }

class SessionState {
  const SessionState._(this.status, {this.fullName, this.role, this.home});

  const SessionState.unknown() : this._(SessionStatus.unknown);
  const SessionState.signedOut() : this._(SessionStatus.signedOut);

  const SessionState.signedIn({String? fullName, String? role, String? home})
      : this._(SessionStatus.signedIn, fullName: fullName, role: role, home: home);

  final SessionStatus status;
  final String? fullName;
  final String? role;
  final String? home;
}

/// Owns the sign-in state. The router redirects on it, so the screen a user sees always matches their session.
class SessionController extends Notifier<SessionState> {
  @override
  SessionState build() => const SessionState.unknown();

  AuthRepository get _repo => ref.read(authRepositoryProvider);

  /// Runs once at launch. A stored token is checked against the server. If the device is offline, the user stays
  /// signed in so the app still opens; cached screens arrive in M3.
  Future<void> restore() async {
    final token = await _repo.storedToken();
    if (token == null) {
      state = const SessionState.signedOut();
      return;
    }
    try {
      final user = await _repo.currentUser();
      state = SessionState.signedIn(fullName: user.fullName, role: user.role);
    } on ApiException catch (e) {
      if (e.unauthorized) {
        await _repo.clearToken();
        state = const SessionState.signedOut();
      } else {
        state = const SessionState.signedIn();
      }
    }
  }

  Future<String?> signIn({required String identifier, required String password}) async {
    try {
      final result = await _repo.signIn(identifier: identifier, password: password);
      state = SessionState.signedIn(role: result.role, home: result.home);
      try {
        final user = await _repo.currentUser();
        state = SessionState.signedIn(fullName: user.fullName, role: user.role, home: result.home);
      } on ApiException {
        // The name is cosmetic; the session is already valid.
      }
      return null;
    } on ApiException catch (e) {
      return e.message;
    }
  }

  Future<void> signOut() async {
    await _repo.signOut();
    state = const SessionState.signedOut();
  }

  /// Called by the API client when the server rejects the token mid-session.
  void expire() {
    state = const SessionState.signedOut();
  }
}

final sessionProvider = NotifierProvider<SessionController, SessionState>(SessionController.new);
