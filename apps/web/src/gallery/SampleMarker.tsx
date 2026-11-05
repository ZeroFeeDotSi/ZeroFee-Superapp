// Always visible in ?demo (?screens shows it on its back button): a screenshot of a sample balance must never pass for a real one.
export function SampleMarker() {
  return (
    <div className="sample-marker" style={{ right: 12 }} role="note">
      Sample data
    </div>
  );
}
