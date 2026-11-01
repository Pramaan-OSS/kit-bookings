/** What a guarded page shows to anyone its guard refuses (lib/roles/runtime.ts pageRole): how to get in, nothing else. */
export function NoAccess({ who = "the app's owner" }: { who?: string }) {
  return (
    <p className="text-muted">
      This page is for {who}. Open the app as its owner from Pramaan, or{" "}
      <a href="/" className="text-accent underline-offset-4 hover:underline">
        sign in
      </a>{" "}
      with an account that has access.
    </p>
  );
}
