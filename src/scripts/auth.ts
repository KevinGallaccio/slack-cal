/**
 * One-time Google OAuth flow (run locally).
 * Prints an auth URL, you sign in, Google redirects to /auth/google/callback
 * which is handled by the running server (run `npm run dev` first).
 */
import { getAuthUrl } from '../google/auth.js';

const url = getAuthUrl();
console.log('\nOpen this URL in your browser to authenticate:\n');
console.log(`  ${url}\n`);
console.log('After consent, the server will store your refresh token in Postgres.');
