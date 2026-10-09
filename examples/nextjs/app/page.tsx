// A Server Component page. The player is a Client Component imported directly:
// no `dynamic(..., { ssr: false })` is needed. Only one example (and therefore
// one video) is mounted at a time.
import { Gallery } from '../components/Gallery';

export default function Page() {
  return (
    <main>
      <h1>react-stream-player</h1>
      <p className="example-note">
        Media defaults to the locally generated fixtures (<code>npm run fixtures</code> in the package, then <code>npm run media</code> here). Set the
        <code> NEXT_PUBLIC_RSP_*</code> environment variables to try your own authorized endpoints.
      </p>
      <Gallery />
    </main>
  );
}
