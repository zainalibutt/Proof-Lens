export default function EvidenceSkeleton() {
  return (
    <div className="evidence-loading" role="status" aria-live="polite">
      <span className="sr-only">Loading evidence library</span>
      <div className="evidence-loading__date" />
      <div className="evidence-loading__grid">
        {Array.from({ length: 4 }, (_, index) => (
          <div className="evidence-loading__card" key={index} aria-hidden="true">
            <div className="evidence-loading__image" />
            <div className="evidence-loading__line evidence-loading__line--short" />
            <div className="evidence-loading__line" />
          </div>
        ))}
      </div>
    </div>
  );
}
