import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { guideHtml, guidePages, type GuidePage } from "@/lib/guide/content";

interface Props {
  params: Promise<{ slug: string }>;
}

/** The site is static: a page the guide doesn't hold is a 404, not something to build when asked. */
export const dynamicParams = false;

export function generateStaticParams() {
  return guidePages().map((page) => ({ slug: page.slug }));
}

/** The page's slug with the pages around it, or a 404. */
function locate(slug: string): { page: GuidePage; previous?: GuidePage; next?: GuidePage } {
  const pages = guidePages();
  const at = pages.findIndex((page) => page.slug === slug);
  if (at === -1) notFound();
  return { page: pages[at], previous: pages[at - 1], next: pages[at + 1] };
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { page } = locate((await params).slug);
  return {
    title: `${page.title} · Curate`,
    description: page.summary,
    // The same page as Markdown, for a reader that would rather have that than HTML.
    alternates: { types: { "text/markdown": `/guide/${page.slug}.md` } },
  };
}

function Neighbour({ page, direction }: { page: GuidePage; direction: "previous" | "next" }) {
  return (
    <Link
      href={`/guide/${page.slug}`}
      rel={direction === "previous" ? "prev" : "next"}
      className={`block border border-rule bg-surface px-5 py-4 transition-all duration-200 hover:border-rule-strong hover:bg-surface-hover ${
        direction === "next" ? "text-right sm:col-start-2" : ""
      }`}
      style={{ borderRadius: "var(--radius-card)" }}
    >
      <span className="block text-[11px] tracking-[0.04em] text-mute">{direction === "previous" ? "Previous" : "Next"}</span>{" "}
      <span className="mt-1 block font-serif text-[18px] leading-[1.25] text-ink">{page.title}</span>
    </Link>
  );
}

export default async function GuideArticle({ params }: Props) {
  const { page, previous, next } = locate((await params).slug);

  return (
    <div className="mx-auto max-w-[700px] px-8 py-12 md:py-16">
      <Link href="/guide" className="text-[13px] text-mute transition-colors hover:text-ink-soft">
        &larr; Guide
      </Link>

      <h1 className="mt-8 font-serif text-[36px] leading-[1.1] tracking-[-0.015em] text-ink font-light">{page.title}</h1>
      <p className="mt-3 text-[13px]">
        <a
          href={`/guide/${page.slug}.md`}
          className="text-mute underline underline-offset-2 transition-colors hover:text-ink-soft"
        >
          View this page as Markdown
        </a>
      </p>

      <article className="guide-prose mt-8" dangerouslySetInnerHTML={{ __html: guideHtml(page) }} />

      <nav aria-label="More of the guide" className="mt-14 grid grid-cols-1 gap-4 border-t border-rule pt-8 sm:grid-cols-2">
        {previous ? <Neighbour page={previous} direction="previous" /> : null}
        {next ? <Neighbour page={next} direction="next" /> : null}
      </nav>
    </div>
  );
}
