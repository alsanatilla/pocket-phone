import type { ReactNode } from "react";

/** A page's heading in Pocket's pixel face, its one-line state under it, and optional actions on the right. */
export function PageTitle({ title, meta, children }: { title: string; meta?: string; children?: ReactNode }) {
  return (
    <div className="flex items-end gap-3 pt-4">
      <div className="mr-auto">
        <h1 className="font-pixel text-4xl leading-none">{title}</h1>
        {meta ? <p className="mt-1 text-sm text-muted-foreground">{meta}</p> : null}
      </div>
      {children}
    </div>
  );
}
