import "./globals.css";

export const metadata = {
  title: "Edict",
  description: "Formal edicts, delivered.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
