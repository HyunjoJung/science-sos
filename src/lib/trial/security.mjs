import { createHash, createHmac, randomBytes } from 'node:crypto';
import { isIP } from 'node:net';

export const validTrialToken = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
export const newTrialToken = () => randomBytes(32).toString('hex');
export const trialSessionHash = (token) => {
  if (!validTrialToken(token)) throw new Error('invalid_session');
  return createHash('sha256').update('science-sos/trial/session\0' + token).digest('hex');
};

/** Trust forwarded IP only on Vercel, where the edge overwrites this header.
 * Else use one shared quota bucket; never trust arbitrary proxy headers locally.
 * The secret HMAC prevents recovering IP addresses from stored quota identifiers.
 */
export function trialIpHash(headers, secret, vercel = false) {
  if (!secret) throw new Error('missing_secret');
  const candidate = vercel ? (headers.get('x-forwarded-for') || '').trim() : '';
  const address = isIP(candidate) ? candidate.toLowerCase() : 'unverified-network';
  return createHmac('sha256', secret).update('science-sos/trial/ip\0' + address).digest('hex');
}
