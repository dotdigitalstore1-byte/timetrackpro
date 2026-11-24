import 'package:dio/dio.dart';
import 'package:flutter_test/flutter_test.dart';

import 'package:dotinout_employee/core/network/api_error_mapper.dart';

DioException _error({
  DioExceptionType type = DioExceptionType.badResponse,
  int? status,
  Object? data,
  bool authenticated = true,
}) {
  final request = RequestOptions(path: '/api/example', extra: {'auth': authenticated});
  return DioException(
    requestOptions: request,
    type: type,
    response: status == null ? null : Response<dynamic>(requestOptions: request, statusCode: status, data: data),
  );
}

void main() {
  test('a dropped connection becomes the friendly offline message', () {
    final e = mapDioError(_error(type: DioExceptionType.connectionError));
    expect(e.offline, isTrue);
    expect(e.message, kOfflineMessage);
  });

  test('timeouts are treated as offline too', () {
    for (final type in [
      DioExceptionType.connectionTimeout,
      DioExceptionType.sendTimeout,
      DioExceptionType.receiveTimeout,
    ]) {
      expect(mapDioError(_error(type: type)).offline, isTrue, reason: type.toString());
    }
  });

  test('a 401 on an authenticated request signs the user out', () {
    var signedOut = false;
    final e = mapDioError(
      _error(status: 401, data: {'error': 'Unauthorized'}),
      onUnauthorized: () {
        signedOut = true;
      },
    );
    expect(e.unauthorized, isTrue);
    expect(signedOut, isTrue);
    expect(e.message, kSessionEndedMessage);
  });

  test('a wrong password (401 on sign-in) does not sign anyone out', () {
    var signedOut = false;
    final e = mapDioError(
      _error(status: 401, data: {'error': 'Invalid email ID / username or password.'}, authenticated: false),
      onUnauthorized: () {
        signedOut = true;
      },
    );
    expect(signedOut, isFalse);
    expect(e.unauthorized, isFalse);
    expect(e.message, 'Invalid email ID / username or password.');
  });

  test('the server message is shown when the server sends one', () {
    final e = mapDioError(_error(status: 403, data: {'error': 'The Dotinout mobile app is for employees only.'}));
    expect(e.message, 'The Dotinout mobile app is for employees only.');
    expect(e.statusCode, 403);
  });

  test('a server error without a readable message gets the generic message', () {
    final e = mapDioError(_error(status: 500, data: '<html>oops</html>'));
    expect(e.message, 'Something went wrong (error 500). Please try again.');
    expect(e.statusCode, 500);
  });

  test('raw error text is never shown to the user', () {
    final e = mapDioError(_error(type: DioExceptionType.unknown));
    expect(e.message, kGenericMessage);
    expect(e.message.toLowerCase(), isNot(contains('dioexception')));
    expect(e.message.toLowerCase(), isNot(contains('err_')));
  });
}
