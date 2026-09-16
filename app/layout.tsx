import "./globals.css";
import BackgroundScene from "@/components/layout/BackgroundScene";

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="hu">
      <body>
        <BackgroundScene />
        {children}
      </body>
    </html>
  );
}
