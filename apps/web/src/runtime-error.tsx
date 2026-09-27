/**
 * Visible banner for engine failures the app chose to catch rather than let
 * the crash boundary handle: replay stop reasons and rejected order intents.
 * Always rendered with an alert role so the message is announced and never
 * mistaken for state that "worked".
 */
export function RuntimeErrorBanner({ message, onDismiss }: { message: string; onDismiss: () => void }) {
  return (
    <div className="runtime-error" role="alert">
      <span>{message}</span>
      <button type="button" onClick={onDismiss}>
        Dismiss
      </button>
    </div>
  );
}
