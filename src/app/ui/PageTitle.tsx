import type { ReactNode } from "react";

/** A page's heading in Pocket's pixel face, its one quiet line under it, and optional actions on the right. */
export function PageTitle({ title, meta, children }: { title: string; meta?: string; children?: ReactNode }) {
  return (
    <div className="flex items-end gap-3 pt-4">
      <div className="mr-auto">
        <h1 className="font-pixel text-[30px] leading-none text-hi">{title}</h1>
        {meta ? <p className="mt-1 text-xs text-dim">{meta}</p> : null}
      </div>
      {children}
    </div>
  );
}
