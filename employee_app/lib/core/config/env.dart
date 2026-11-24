/// Build-time configuration. Passed with --dart-define, never bundled from a .env file.
class Env {
  Env._();

  /// Base URL of the Dotinout web server, for example https://your-domain.example
  static const String apiBaseUrl = String.fromEnvironment(
    'API_BASE_URL',
    defaultValue: 'https://timetrackpro-ai.vercel.app',
  );

  /// The base URL without trailing slashes, so paths such as /api/... join cleanly.
  static String get origin => apiBaseUrl.trim().replaceAll(RegExp(r'/+$'), '');

  static bool get isConfigured => origin.isNotEmpty;
}
