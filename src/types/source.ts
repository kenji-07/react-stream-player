/** Explicit source protocol. `"auto"` detects from the MIME hint or the URL path. */
export type SourceType = 'auto' | 'hls' | 'dash' | 'mp4';

/**
 * One quality of ONE progressive video. All variants of a source must share the
 * same content and timeline; only the selected variant is ever loaded.
 */
export interface ProgressiveVariant {
  /** Stable, unique ID used for selection (`quality` / `setQuality`). */
  id: string;
  /** Media URL or a Blob. Blob object URLs are created and revoked by the package. */
  src: string | Blob;
  /** Plain-text label shown in the quality menu. Never interpreted as HTML. */
  label: string;
  height?: number;
  width?: number;
  /** Bits per second. */
  bitrate?: number;
  mimeType?: string;
}

interface SourceIdentity {
  /**
   * Logical identity of the content. A change starts a new content session.
   * With the same `id` and `revision`, a changed URL is treated as a transport
   * refresh (e.g. a re-signed URL) that preserves in-session state.
   * Never reuse an ID/revision for different content.
   */
  id?: string;
  /** Content/timeline revision. A change starts a new content session. */
  revision?: string | number;
}

export type PlayerSource =
  | (SourceIdentity & {
      src: string;
      type?: SourceType;
      /** MIME hint, e.g. `application/x-mpegurl`, `application/dash+xml`, `video/mp4`. */
      mimeType?: string;
    })
  | (SourceIdentity & {
      src: Blob;
      type: 'mp4';
      mimeType?: string;
    })
  | (SourceIdentity & {
      type: 'mp4';
      variants: ProgressiveVariant[];
    });

/** Resolved protocol after detection. */
export type ResolvedSourceType = 'hls' | 'dash' | 'mp4';
