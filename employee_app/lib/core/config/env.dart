/// Build-time configuration. Passed with --dart-define, never bundled from a .env file.
class Env {
  Env._();

  /// Base URL of the Dotinout web server, for example https://your-domain.example
  static const String apiBaseUrl = String.fromEnvironment('https://vercel.com/t5-68b5/timetrackpro', defaultValue: 'https://timetrackpro-ai.vercel.app');

  static bool get isConfigured => apiBaseUrl.isNotEmpty;
}
