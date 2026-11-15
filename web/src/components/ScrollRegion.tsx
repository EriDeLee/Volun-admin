import type { ReactNode } from "react";

export default function ScrollRegion({
  label,
  className = "activity-table-wrap",
  children,
}: {
  label: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <div
      className={className}
      role="region"
      aria-label={`${label}，可滚动查看更多内容`}
      tabIndex={0}
    >
      {children}
    </div>
  );
}
