// Public sample streams (components/samples/samples.json): every sample is
// classified for this package and loadable ones open in one <Player>.
import Link from 'next/link';
import { SampleBrowser } from '../../components/samples/SampleBrowser';

export const metadata = {
  title: 'Public sample streams — react-stream-player',
};

export default function SamplesPage() {
  return (
    <main>
      <p>
        <Link href="/">← Usage examples</Link>
      </p>
      <h1>Public sample streams</h1>
      <p className="example-note">
        Third-party test streams (Google, Apple, Bitmovin and others), loaded directly from their hosts. Availability, codecs and DRM depend on your
        browser and network; each sample says what to expect. Content belongs to its owners and is streamed, not redistributed.
      </p>
      <SampleBrowser />
    </main>
  );
}
