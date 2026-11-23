/// An error the user can read. The message is always written for people, never a raw socket or HTTP error.
class ApiException implements Exception {
  const ApiException(
    this.message, {
    this.statusCode,
    this.offline = false,
    this.unauthorized = false,
  });

  final String message;
  final int? statusCode;

  /// No connection, or the server could not be reached.
  final bool offline;

  /// The token is missing, expired or revoked. The user must sign in again.
  final bool unauthorized;

  @override
  String toString() => message;
}
