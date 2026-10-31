// Strava OAuth and API. Credentials are entered in the app and kept in this browser only,
// so no secret is ever committed to the (public) repository.
import { prefs } from './store.js';

const AUTHORIZE_URL = 'https://www.strava.com/oauth/authorize';
const TOKEN_URL = 'https://www.strava.com/oauth/token';
const API = 'https://www.strava.com/api/v3';
const SCOPE = 'read,activity:read_all';
export const PAGE_SIZE = 200;

export class StravaError extends Error {
  constructor(message, kind = 'error') {
    super(message);
    this.kind = kind;
  }
}

export const credentials = () => prefs.get('credentials');
export const setCredentials = (clientId, clientSecret) => prefs.set('credentials', { clientId, clientSecret });
export const token = () => prefs.get('token');
export const redirectURI = () => location.origin + location.pathname;

export function beginAuthorization() {
  const creds = credentials();
  if (!creds) throw new StravaError('Add your Strava API credentials first.');
  const state = crypto.randomUUID();
  prefs.set('oauthState', state);
  const params = new URLSearchParams({
    client_id: creds.clientId,
    redirect_uri: redirectURI(),
    response_type: 'code',
    approval_prompt: 'auto',
    scope: SCOPE,
    state,
  });
  location.href = `${AUTHORIZE_URL}?${params}`;
}

/** Handles the redirect back from Strava. Returns true if a login was completed. */
export async function completeAuthorization() {
  const params = new URLSearchParams(location.search);
  if (!params.has('code') && !params.has('error')) return false;
  history.replaceState(null, '', location.pathname);

  if (params.get('error')) throw new StravaError(params.get('error') === 'access_denied' ? 'Strava access was denied.' : params.get('error'));
  const expected = prefs.get('oauthState');
  prefs.set('oauthState', null);
  if (expected && params.get('state') !== expected) throw new StravaError('The Strava login could not be verified. Please try again.');
  if (!(params.get('scope') || '').includes('activity:read')) {
    throw new StravaError('Please allow Conquerors to view your activities.');
  }
  const creds = credentials();
  const tokenResponse = await post(TOKEN_URL, {
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
    code: params.get('code'),
    grant_type: 'authorization_code',
  });
  prefs.set('token', pickToken(tokenResponse));
  return true;
}

export function signOut() {
  const current = token();
  prefs.set('token', null);
  if (current) {
    fetch('https://www.strava.com/oauth/deauthorize', {
      method: 'POST',
      headers: { Authorization: `Bearer ${current.accessToken}` },
    }).catch(() => {});
  }
}

/** One page of activities. Indoor, manual and virtual activities have no route and are dropped. */
export async function activitiesPage(page, after) {
  const params = new URLSearchParams({ per_page: PAGE_SIZE, page });
  if (after) params.set('after', Math.floor(after / 1000));
  const summaries = await get(`${API}/athlete/activities?${params}`);
  const activities = summaries.map(toActivity).filter(Boolean);
  return { activities, rawCount: summaries.length };
}

function toActivity(s) {
  const sport = s.sport_type || s.type || 'Workout';
  const polyline = s.map && s.map.summary_polyline;
  if (s.trainer || s.manual || sport.startsWith('Virtual') || !polyline) return null;
  return {
    id: s.id,
    name: s.name || sport,
    sportType: sport,
    startDate: Date.parse(s.start_date),
    distance: s.distance || 0,
    movingTime: s.moving_time || 0,
    polyline,
  };
}

function pickToken(r) {
  const previous = token();
  return {
    accessToken: r.access_token,
    refreshToken: r.refresh_token,
    expiresAt: r.expires_at,
    athlete: r.athlete
      ? { id: r.athlete.id, firstname: r.athlete.firstname, lastname: r.athlete.lastname, profile: r.athlete.profile, city: r.athlete.city }
      : previous && previous.athlete,
  };
}

async function accessToken() {
  const current = token();
  if (!current) throw new StravaError('Not connected to Strava.', 'unauthorized');
  if (Date.now() / 1000 < current.expiresAt - 120) return current.accessToken;
  const creds = credentials();
  const refreshed = pickToken(await post(TOKEN_URL, {
    client_id: creds.clientId,
    client_secret: creds.clientSecret,
    grant_type: 'refresh_token',
    refresh_token: current.refreshToken,
  }));
  prefs.set('token', refreshed);
  return refreshed.accessToken;
}

async function get(url) {
  return send(url, { headers: { Authorization: `Bearer ${await accessToken()}` } });
}

function post(url, body) {
  return send(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body),
  });
}

async function send(url, options) {
  let response;
  try {
    response = await fetch(url, options);
  } catch {
    throw new StravaError("Couldn't reach Strava. Check your connection and try again.");
  }
  if (response.status === 401) throw new StravaError('Your Strava session expired. Please connect again.', 'unauthorized');
  if (response.status === 429) {
    throw new StravaError("Strava's rate limit was reached. Try again in 15 minutes — your progress so far is saved.", 'rateLimited');
  }
  if (response.status === 400) throw new StravaError('Strava rejected the request. Check your client ID and secret in Settings.');
  if (!response.ok) throw new StravaError(`Strava returned an error (HTTP ${response.status}).`);
  return response.json();
}
