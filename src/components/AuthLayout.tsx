import type { PropsWithChildren, ReactNode } from "react";

import { CheckIcon, LogoMark } from "./icons";

interface AuthLayoutProps {
  title: string;
  subtitle: string;
  footer: ReactNode;
}

const FEATURES = [
  "Kanban board with drag & drop",
  "Subtasks, timelines and image attachments",
  "Works offline and syncs across devices",
];

export default function AuthLayout({
  title,
  subtitle,
  footer,
  children,
}: PropsWithChildren<AuthLayoutProps>) {
  return (
    <main className="flex min-h-screen bg-slate-50">
      {/* Brand panel (desktop) */}
      <aside className="relative hidden w-[44%] max-w-xl overflow-hidden bg-gradient-to-br from-brand-600 via-brand-500 to-indigo-400 p-12 text-white lg:flex lg:flex-col">
        <div className="absolute -right-24 -top-24 h-80 w-80 rounded-full bg-white/10 blur-2xl" />
        <div className="absolute -bottom-32 -left-16 h-96 w-96 rounded-full bg-indigo-300/20 blur-3xl" />
        <div className="relative flex items-center gap-3">
          <span className="inline-flex h-10 w-10 items-center justify-center rounded-xl bg-white/15 ring-1 ring-white/30">
            <CheckIcon width={20} height={20} strokeWidth={3} />
          </span>
          <span className="text-lg font-semibold">Todo Board</span>
        </div>
        <div className="relative mt-auto">
          <h2 className="text-4xl font-bold leading-tight">
            Plan less.
            <br />
            Get more done.
          </h2>
          <ul className="mt-8 space-y-3 text-brand-50">
            {FEATURES.map((feature) => (
              <li key={feature} className="flex items-center gap-3">
                <span className="inline-flex h-6 w-6 items-center justify-center rounded-full bg-white/15">
                  <CheckIcon width={14} height={14} strokeWidth={3} />
                </span>
                {feature}
              </li>
            ))}
          </ul>
        </div>
      </aside>

      {/* Form */}
      <section className="flex flex-1 items-center justify-center px-5 py-10 sm:px-8">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex flex-col items-center text-center lg:items-start lg:text-left">
            <LogoMark className="h-12 w-12 lg:hidden" />
            <h1 className="mt-5 text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl lg:mt-0">
              {title}
            </h1>
            <p className="mt-2 text-sm text-slate-500">{subtitle}</p>
          </div>
          {children}
          <p className="mt-8 text-center text-sm text-slate-500">{footer}</p>
        </div>
      </section>
    </main>
  );
}
