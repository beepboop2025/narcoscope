import type { ReactNode } from 'react'

export default function DataTableViewport({
  label,
  children,
}: {
  label: string
  children: ReactNode
}) {
  const accessibleLabel = `${label}. Scroll horizontally for all columns.`

  return (
    <div
      className="data-table-viewport"
      role="region"
      aria-label={accessibleLabel}
      tabIndex={0}
    >
      <span className="data-table-viewport__hint" aria-hidden="true">
        Scroll for all columns <span aria-hidden="true">&#8594;</span>
      </span>
      {children}
    </div>
  )
}
