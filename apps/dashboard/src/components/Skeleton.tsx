import "./Skeleton.css"

interface SkeletonProps {
  width?: string | number
  height?: string | number
  borderRadius?: string | number
  className?: string
}

export function Skeleton({ width = "100%", height = 16, borderRadius = 4, className = "" }: SkeletonProps) {
  return (
    <div
      className={`skeleton ${className}`}
      style={{ width, height, borderRadius }}
    />
  )
}

export function SkeletonCard() {
  return (
    <div className="skeleton-card">
      <Skeleton height={14} width="40%" />
      <Skeleton height={32} width="60%" style={{ marginTop: 8 }} />
      <Skeleton height={12} width="80%" style={{ marginTop: 8 }} />
    </div>
  )
}

export function SkeletonRow() {
  return (
    <div className="skeleton-row">
      <div className="skeleton-row-icon">
        <Skeleton width={32} height={32} borderRadius="50%" />
      </div>
      <div className="skeleton-row-body">
        <Skeleton height={13} width="55%" />
        <Skeleton height={11} width="35%" style={{ marginTop: 6 }} />
      </div>
      <Skeleton height={20} width={60} borderRadius={10} style={{ flexShrink: 0 }} />
    </div>
  )
}

export function SkeletonText({ lines = 3 }: { lines?: number }) {
  const widths = ["100%", "85%", "70%", "90%", "60%"]
  return (
    <div className="skeleton-text">
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} height={13} width={widths[i % widths.length]} style={{ marginBottom: 8 }} />
      ))}
    </div>
  )
}
