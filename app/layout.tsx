import type { ReactNode } from "react";

export const metadata = {
  title: "Wayfinder",
  description: "Find specialists, trials, advocacy, and aid, then get seen.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
