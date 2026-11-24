// Base address of the Dotinout web server. The native app calls the same /api routes the website uses.
// Set EXPO_PUBLIC_API_BASE_URL in eas.json (or as an EAS environment variable) to point a build elsewhere.
const DEFAULT_API_BASE_URL = 'https://timetrackpro-ai.vercel.app';

const raw = (process.env.EXPO_PUBLIC_API_BASE_URL ?? '').trim() || DEFAULT_API_BASE_URL;

/** The base URL without trailing slashes, so that paths such as /api/... join cleanly. */
export const API_ORIGIN = raw.replace(/\/+$/, '');
