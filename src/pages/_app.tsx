import type { AppProps } from "next/app";
import Head from "next/head";
import "../styles/globals.css";
import { AuthProvider } from "../context/AuthContext"; // đường dẫn tùy project

export default function MyApp({ Component, pageProps }: AppProps) {
  return (
    <AuthProvider>
      <Head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="theme-color" content="#4f46e5" />
        <link rel="manifest" href="/frontend_todo/manifest.json" />
        <link
          rel="apple-touch-icon"
          sizes="180x180"
          href="/frontend_todo/apple-touch-icon.png"
        />
      </Head>
      <Component {...pageProps} />
    </AuthProvider>
  );
}
