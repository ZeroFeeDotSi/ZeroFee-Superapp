// A read that failed or is slow (Job 1, criterion 5; B21): one quiet line where the content is, with Retry, over what
// the screen knew last. Never a Problem screen: a Problem screen is only for something the person did.
export function ReadLine({ text, onRetry, retry = "Retry" }: { text: string; onRetry?: () => void; retry?: string }) {
  return (
    <p className="zf-small zf-readline" role="status">
      <span>{text}</span>
      {onRetry && <button type="button" className="zf-link zf-readline__retry" onClick={onRetry}>{retry}</button>}
    </p>
  );
}
