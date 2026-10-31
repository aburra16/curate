import { BuiltOnBrainstorm } from "@/components/built-on-brainstorm";

const SOURCE = "https://github.com/aburra16/curate";

/** The foot of every page: where the source is and under which license, then the shared Built on Brainstorm line. */
export function SiteFooter() {
  return (
    <footer className="border-t border-rule">
      <div className="mx-auto flex max-w-[1100px] flex-wrap items-center justify-between gap-x-6 gap-y-1 px-8 py-2 text-[12px] text-mute">
        <p>
          Source:{" "}
          <a
            href={SOURCE}
            target="_blank"
            rel="noopener noreferrer"
            className="text-ink-soft underline underline-offset-2 transition-colors hover:text-ink"
          >
            github.com/aburra16/curate
          </a>{" "}
          (AGPL-3.0)
        </p>
        <BuiltOnBrainstorm />
      </div>
    </footer>
  );
}
