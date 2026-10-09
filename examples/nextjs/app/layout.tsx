import type { ReactNode } from 'react';
// The package stylesheet is a side-effect import; the root layout is a Server Component.
import 'react-stream-player/styles.css';
import './globals.css';

export const metadata = {
  title: 'react-stream-player examples',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
