import type { Problem } from "@/lib/listCheck";
import { cn } from "@/lib/utils";

/** The problems about one field, or with `null` the ones about no field. */
export function problemsFor(problems: Problem[], field: string | null): Problem[] {
  return problems.filter((problem) => problem.field === field);
}

/** Whether any of the problems would stop the write. */
export const hasBlocking = (problems: Problem[]): boolean => problems.some((problem) => problem.blocking);

/**
 * Lists what Brainstorm's check found, in its words. A problem that would stop
 * the write carries `data-blocking`. Nothing shows when there are none.
 */
export function CheckProblems({ problems }: { problems: Problem[] }) {
  if (problems.length === 0) return null;

  return (
    <ul className="mt-1.5 flex flex-col gap-1">
      {problems.map((problem, i) => (
        <li
          key={`${problem.code}:${i}`}
          data-blocking={problem.blocking ? "" : undefined}
          className={cn("text-[11px] leading-[1.5]", problem.blocking ? "text-red-400" : "text-mute")}
        >
          {problem.message}
        </li>
      ))}
    </ul>
  );
}
