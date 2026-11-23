import 'package:dio/dio.dart';

import 'api_exception.dart';

const String kOfflineMessage = 'No internet connection. Connect to the internet and try again.';
const String kGenericMessage = 'Something went wrong. Please try again.';
const String kSessionEndedMessage = 'Your session has ended. Please sign in again.';

/// Turns a Dio error into an [ApiException]. Pure, so it can be unit-tested without a network.
///
/// [onUnauthorized] is called only when a request that carried the session token gets a 401. A failed sign-in (also a
/// 401) must not sign the user out, so those requests set `extra['auth'] = false`.
ApiException mapDioError(DioException e, {void Function()? onUnauthorized}) {
  final status = e.response?.statusCode;
  final authenticated = e.requestOptions.extra['auth'] != false;

  if (status == 401 && authenticated) {
    onUnauthorized?.call();
    return const ApiException(kSessionEndedMessage, statusCode: 401, unauthorized: true);
  }

  switch (e.type) {
    case DioExceptionType.connectionError:
    case DioExceptionType.connectionTimeout:
    case DioExceptionType.sendTimeout:
    case DioExceptionType.receiveTimeout:
      return const ApiException(kOfflineMessage, offline: true);
    case DioExceptionType.cancel:
    case DioExceptionType.badCertificate:
    case DioExceptionType.unknown:
    case DioExceptionType.badResponse:
      break;
  }

  final data = e.response?.data;
  if (data is Map && data['error'] is String) {
    return ApiException(data['error'] as String, statusCode: status);
  }
  return ApiException(kGenericMessage, statusCode: status);
}
