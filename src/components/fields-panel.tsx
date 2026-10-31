import type { FieldDecl, FieldRequirement } from "@/lib/dlistFields";

interface Props {
  /** `definition.fields`: already required, then recommended, then optional, in the header's order within each. */
  fields: FieldDecl[];
}

const ORDER: FieldRequirement[] = ["required", "recommended", "optional"];

/** A list this short is shown open; a longer one is a line to open. */
const OPEN_UP_TO = 6;

/**
 * A list's declared fields: each with its requirement, its
 * type and the header's own words for it. The order is the definition's.
 */
export function FieldsPanel({ fields }: Props) {
  if (fields.length === 0) {
    return <p className="text-[12px] text-mute">This list declares no fields.</p>;
  }
  const counts = ORDER.map((r) => [r, fields.filter((f) => f.requirement === r).length] as const).filter(
    ([, n]) => n > 0,
  );

  return (
    <details open={fields.length <= OPEN_UP_TO} className="group border border-rule bg-surface" style={{ borderRadius: "var(--radius-card)" }}>
      <summary className="flex cursor-pointer select-none flex-wrap items-baseline gap-x-3 gap-y-1 px-4 py-3 text-[13px] text-ink-soft hover:text-ink">
        <span className="font-medium text-ink">Fields</span>
        <span className="text-[12px] text-mute">
          {fields.length}: {counts.map(([r, n]) => `${n} ${r}`).join(", ")}
        </span>
      </summary>
      <table className="w-full border-t border-rule text-left text-[12px]">
        <thead className="sr-only">
          <tr>
            <th>Field</th>
            <th>Requirement</th>
            <th>Type</th>
            <th>Description</th>
          </tr>
        </thead>
        <tbody>
          {fields.map((f) => (
            <tr key={f.name} className="border-b border-rule last:border-b-0 align-baseline">
              <th scope="row" className="whitespace-nowrap px-4 py-2 font-mono text-[12px] font-normal text-ink">
                {f.name}
              </th>
              <td className="whitespace-nowrap px-2 py-2 text-mute">{f.requirement}</td>
              <td className="whitespace-nowrap px-2 py-2 font-mono text-mute">{f.type}</td>
              <td className="px-2 py-2 pr-4 text-ink-soft">{f.description}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </details>
  );
}
