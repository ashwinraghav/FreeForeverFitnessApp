import { describe, expect, it } from 'vitest';
import { assertDebugAllowed, isLocalDevelopmentHostname } from '../appCheck.js';

/**
 * The guard that keeps the App Check debug path from shipping. The Firebase
 * call itself needs a browser and real attestation infrastructure and is not
 * testable here — that gap is named in SYNC.md — but the refusal logic is pure
 * and this suite is what makes "cannot ship enabled to production" a tested
 * property rather than a hope.
 */

describe('isLocalDevelopmentHostname', () => {
  it('accepts the local development origins', () => {
    for (const host of ['localhost', '127.0.0.1', '::1', '[::1]', '0.0.0.0', 'app.localhost']) {
      expect(isLocalDevelopmentHostname(host), host).toBe(true);
    }
  });

  it('rejects everything that could be a deployment', () => {
    for (const host of [
      'thefreeforeverfitnessapp.web.app',
      'example.com',
      'localhost.evil.com',
      '192.168.1.10', // LAN is not localhost; a phone on the network is production-shaped
      '127.0.0.1.nip.io',
    ]) {
      expect(isLocalDevelopmentHostname(host), host).toBe(false);
    }
  });
});

describe('assertDebugAllowed', () => {
  it('throws on any non-local hostname', () => {
    expect(() => assertDebugAllowed('thefreeforeverfitnessapp.web.app')).toThrow(/refused/);
  });

  it('allows local origins and non-browser processes', () => {
    expect(() => assertDebugAllowed('localhost')).not.toThrow();
    // No location at all (Node test runner): the browser debug token is inert.
    expect(() => assertDebugAllowed(undefined)).not.toThrow();
  });
});
