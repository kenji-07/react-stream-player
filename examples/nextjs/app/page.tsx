// A Server Component page. The player is a Client Component imported directly:
// no `dynamic(..., { ssr: false })` is needed. Only one example (and therefore
// one video) is mounted at a time.
import Link from 'next/link';
import { Gallery } from '../components/Gallery';
import { mediaMode } from '../components/media';

export default function Page() {
  return (
    <main>
      <h1>react-stream-player</h1>
      <p>
        <Link href="/samples">Browse all public sample streams →</Link>
      </p>
      <p className="example-note">
        {mediaMode === 'public' ? (
          <>
            Examples use public sample streams (no setup). Set <code>NEXT_PUBLIC_RSP_MEDIA=local</code> to use the package&apos;s generated fixtures
            instead (<code>npm run fixtures</code> in the package, then <code>npm run media</code> here).
          </>
        ) : (
          <>
            Examples use the locally generated fixtures (<code>NEXT_PUBLIC_RSP_MEDIA=local</code>).
          </>
        )}{' '}
        <code>NEXT_PUBLIC_RSP_*</code> variables override individual endpoints.
      </p>
      <Gallery />
    </main>
  );
}
