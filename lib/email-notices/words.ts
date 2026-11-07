// What the owner and the app are told when email is off. Written once, here: the server answers with it and the
// owner's page shows it, so there is never a second wording.

/** What is said when email is not switched on for this app, or the platform has no sender yet. */
export const OFF_NOTE = "Email isn't switched on for this app yet.";

/** What is said when the platform is slow to answer: the email is still on its way, and how it went is noted later. */
export const PENDING_NOTE =
  "The email is still being sent. How it went shows on the owner's email page once the platform answers.";
