import type { Metadata } from "next";
import Link from "next/link";
import { guidePages, SITE_URL } from "@/lib/guide/content";

export const metadata: Metadata = {
  title: "Guide · Curate",
  description: "What a DList is, and how to find, read, add to and make lists on Curate, in plain words.",
};

/** The guide's front page: what it is, where an AI can read it, and every page. */
export default function GuideIndex() {
  const llms = `${SITE_URL}/llms.txt`;

  return (
    <div className="mx-auto max-w-[700px] px-8 py-12 md:py-16">
      <h1 className="font-serif text-[32px] leading-[1.1] tracking-[-0.015em] text-ink font-light">Guide</h1>
      <p className="mt-4 text-[15px] leading-[1.6] text-ink-soft">
        A DList is a list that anyone can add to. This guide explains what that means in plain words, and shows you how
        to find lists, add to them and make your own.
      </p>

      <aside
        className="mt-8 border border-rule bg-surface-raised px-5 py-4 text-[14px] leading-[1.6] text-ink-soft"
        style={{ borderRadius: "var(--radius-card)" }}
      >
        <strong className="font-medium text-ink">Prefer to ask an AI?</strong> Point it at{" "}
        <a href={llms} className="break-all text-ink underline underline-offset-2 transition-colors hover:text-accent">
          {llms}
        </a>{" "}
        and ask it to explain DLists.
      </aside>

      <div className="mt-10 flex flex-col gap-3">
        {guidePages().map((page) => (
          <Link
            key={page.slug}
            href={`/guide/${page.slug}`}
            className="block border border-rule bg-surface px-6 py-5 transition-all duration-200 hover:border-rule-strong hover:bg-surface-hover"
            style={{ borderRadius: "var(--radius-card)" }}
          >
            <h2 className="font-serif text-[22px] leading-[1.2] tracking-[-0.01em] text-ink">{page.title}</h2>
            <p className="mt-1.5 text-[14px] leading-[1.55] text-ink-soft">{page.summary}</p>
          </Link>
        ))}
      </div>
    </div>
  );
}
