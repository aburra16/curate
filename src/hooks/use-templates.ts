"use client";

import { useEffect, useState } from "react";
import type { LinkRef, UrlTemplate } from "@/lib/linkTemplates";
import { fetchTemplates } from "@/services/templates";

const NO_TEMPLATES = new Map<string, UrlTemplate>();

/**
 * The URL templates a definition's links pin (`fetchTemplates`), by id.
 * Empty until they are read, and for any that can't be found. The answer is
 * kept with the question it answers, so new links show nothing of the old
 * ones' templates.
 */
export function useTemplates(refs: LinkRef[]): Map<string, UrlTemplate> {
  const key = JSON.stringify(refs);
  const [found, setFound] = useState<{ key: string; templates: Map<string, UrlTemplate> } | null>(null);

  useEffect(() => {
    const pinned = JSON.parse(key) as LinkRef[];
    if (!pinned.length) return;
    let cancelled = false;
    fetchTemplates(pinned)
      .then((templates) => {
        if (!cancelled) setFound({ key, templates });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [key]);

  return found?.key === key ? found.templates : NO_TEMPLATES;
}
