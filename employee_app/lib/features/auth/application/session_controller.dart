import 'dart:async';

import 'package:flutter_riverpod/flutter_riverpod.dart';

import '../../../app/providers.dart';
import '../../../core/network/api_exception.dart';
import '../data/auth_repository.dart';

enum SessionStatus { unknown, signedOut, signedIn }

class SessionState {
  const SessionState._(this.status, {this.userId, this.fullName, this.role, this.home});

  const SessionState.unknown() : this._(SessionStatus.unknown);
  const SessionState.signedOut() : this._(SessionStatus.signedOut);

  const SessionState.signedIn({String? userId, String? fullName, String? role, String? home})
      : this._(SessionStatus.signedIn, userId: userId, fullName: fullName, role: role, home: home);

  final SessionStatus status;

  /// Null only when the server has never answered for this session (for example, a fresh sign-in while offline).
  /// The offline cache is not used without it.
  final String? userId;
  final String? fullName;
  final String? role;
  final String? home;
}

/// Owns the sign-in state. The router redirects on it, so the screen a user sees always matches their session.
class SessionController extends Notifier<SessionState> {
  @override
  SessionState build() => const SessionState.unknown();

  AuthRepository get _repo => ref.read(authRepositoryProvider);

  Future<void> _clearCache() async {
    try {
      await ref.read(cacheProvider).clearAll();
    } catch (_) {
      // Clearing must never block sign-out.
    }
  }

  /// Runs once at launch. A stored token is checked against the server. If the device is offline, the user stays
  /// signed in and the cached screens still open.
  Future<void> restore() async {
    final token = await _repo.storedToken();
    if (token == null) {
      state = const SessionState.signedOut();
      return;
    }
    try {
      final user = await _repo.currentUser();
      state = SessionState.signedIn(userId: user.id, fullName: user.fullName, role: user.role);
    } on ApiException catch (e) {
      if (e.unauthorized) {
        await _repo.clearToken();
        await _clearCache();
        state = const SessionState.signedOut();
      } else {
        state = SessionState.signedIn(userId: await _repo.storedUserId());
      }
    }
  }

  Future<String?> signIn({required String identifier, required String password}) async {
    try {
      final result = await _repo.signIn(identifier: identifier, password: password);
      await _clearCache();
      String? userId;
      String? fullName;
      try {
        final user = await _repo.currentUser();
        userId = user.id;
        fullName = user.fullName;
      } on ApiException {
        // The name is cosmetic and the session is already valid. Cached screens wait for a later launch.
      }
      state = SessionState.signedIn(userId: userId, fullName: fullName, role: result.role, home: result.home);
      return null;
    } on ApiException catch (e) {
      return e.message;
    }
  }

  Future<void> signOut() async {
    await _repo.signOut();
    await _clearCache();
    state = const SessionState.signedOut();
  }

  /// Called by the API client when the server rejects the token mid-session. The token and cache are removed too.
  void expire() {
    unawaited(_repo.clearToken());
    unawaited(_clearCache());
    state = const SessionState.signedOut();
  }
}

final sessionProvider = NotifierProvider<SessionController, SessionState>(SessionController.new);
