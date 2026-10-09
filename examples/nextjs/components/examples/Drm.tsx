'use client';

import { useMemo } from 'react';
import { Player, type DrmConfig } from 'react-stream-player';
import { media } from '../media';

// DRM provider configuration (Widevine / PlayReady over DASH, FairPlay over
// HLS). Endpoints come from environment variable names; the short-lived token
// is fetched from YOUR backend at license time and sent only to the license
// server. Nothing here is a secret, and the player never stores or logs tokens.
async function fetchLicenseToken(keySystem: string): Promise<string | null> {
  const response = await fetch(`/api/license-token?keySystem=${encodeURIComponent(keySystem)}`, { credentials: 'same-origin' });
  if (!response.ok) return null;
  const { token } = (await response.json()) as { token?: string };
  return token ?? null;
}

export function Drm() {
  const drm = useMemo<DrmConfig>(() => {
    const keySystems: DrmConfig['keySystems'] = {};
    if (media.drm.widevineLicense) keySystems['com.widevine.alpha'] = { licenseUrl: media.drm.widevineLicense };
    if (media.drm.playreadyLicense) keySystems['com.microsoft.playready'] = { licenseUrl: media.drm.playreadyLicense };
    if (media.drm.fairplayLicense) {
      keySystems['com.apple.fps'] = {
        licenseUrl: media.drm.fairplayLicense,
        ...(media.drm.fairplayCertificate ? { serverCertificateUrl: media.drm.fairplayCertificate } : {}),
      };
    }
    return {
      keySystems,
      preferredKeySystems: ['com.widevine.alpha', 'com.microsoft.playready', 'com.apple.fps'],
      getLicenseToken: ({ keySystem }) => fetchLicenseToken(keySystem),
    };
  }, []);

  const src = media.drm.dash ?? media.drm.hls;
  if (!src) {
    return (
      <p className="example-note">
        Set NEXT_PUBLIC_RSP_DRM_DASH_URL (or _HLS_URL) and the matching NEXT_PUBLIC_RSP_*_LICENSE_URL variables to an authorized test provider.
      </p>
    );
  }
  return <Player source={{ id: 'protected-1', src, type: media.drm.dash ? 'dash' : 'hls' }} drm={drm} onError={(e) => console.error(e.code)} />;
}
