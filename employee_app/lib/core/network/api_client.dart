import 'package:dio/dio.dart';

import '../config/env.dart';
import '../storage/token_store.dart';
import 'api_error_mapper.dart';
import 'api_exception.dart';

/// HTTP client for the Dotinout API. Adds the bearer token, maps errors to user-readable messages, and retries nothing
/// by itself. Callers decide what is safe to retry (reads only; writes are never retried, so a punch cannot be sent twice).
class ApiClient {
  ApiClient({required TokenStore tokens, this.onUnauthorized, Dio? dio})
      : dio = dio ?? _buildDio(),
        _tokens = tokens {
    this.dio.interceptors.add(
      InterceptorsWrapper(
        onRequest: (options, handler) async {
          if (options.extra['auth'] != false) {
            final token = await _tokens.read();
            if (token != null && token.isNotEmpty) {
              options.headers['Authorization'] = 'Bearer $token';
            }
          }
          handler.next(options);
        },
      ),
    );
  }

  final Dio dio;
  final TokenStore _tokens;

  /// Called when the server rejects the stored token. The session controller uses it to return to sign-in.
  final void Function()? onUnauthorized;

  static Dio _buildDio() {
    return Dio(
      BaseOptions(
        baseUrl: Env.origin,
        connectTimeout: const Duration(seconds: 15),
        receiveTimeout: const Duration(seconds: 30),
        sendTimeout: const Duration(seconds: 30),
        responseType: ResponseType.json,
        headers: const {'Accept': 'application/json'},
      ),
    );
  }

  Future<Map<String, dynamic>> getJson(String path, {Map<String, dynamic>? query, bool authenticated = true}) {
    return _run(() => dio.get<dynamic>(
          path,
          queryParameters: query,
          options: Options(extra: {'auth': authenticated}),
        ));
  }

  Future<Map<String, dynamic>> postJson(String path, {Object? body, bool authenticated = true}) {
    return _run(() => dio.post<dynamic>(
          path,
          data: body,
          options: Options(extra: {'auth': authenticated}),
        ));
  }

  Future<Map<String, dynamic>> _run(Future<Response<dynamic>> Function() call) async {
    if (!Env.isConfigured) {
      throw const ApiException('The app is not configured. Contact your administrator.');
    }
    try {
      final res = await call();
      final data = res.data;
      return data is Map<String, dynamic> ? data : <String, dynamic>{};
    } on DioException catch (e) {
      throw mapDioError(e, onUnauthorized: onUnauthorized);
    }
  }
}
