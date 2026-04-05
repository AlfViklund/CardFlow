import type { ReactNode } from 'react';
import './globals.css';

export const metadata = {
  title: 'CardFlow Foundation',
  description: 'CardFlow platform foundation scaffold',
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
