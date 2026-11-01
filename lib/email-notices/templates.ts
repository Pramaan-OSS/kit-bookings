// The emails the app sends. Plain text, one function each: edit the words freely, add a template by adding a line.
// A subject is fixed text, never a person's words: the app sends from the platform's address, and what a visitor typed
// must not be able to head a message that looks like the platform's own. A person's words go in the body, short.
// A template is given only what the caller passes in `data` (text, never markup), and what it makes is a subject and
// a body. There is no address here: the caller says who it goes to, and the address is never written down.
export type Message = { subject: string; text: string };
export type Data = Record<string, string>;

/** A value as plain text for a line: no line breaks, at most 60 characters. */
const line = (data: Data, name: string) =>
  (Object.hasOwn(data, name) ? String(data[name]) : "")
    // biome-ignore lint/suspicious/noControlCharactersInRegex: control characters are what this removes
    .replace(/[\u0000-\u001f\u007f]+/gu, " ")
    .trim()
    .slice(0, 60);

export const TEMPLATES: Readonly<Record<string, (data: Data) => Message>> = {
  // The owner's test, from the email page: `data` is empty.
  test: () => ({
    subject: "A test email from your app",
    text: "This is a test email from your app. If you can read it, email is working.",
  }),
  // data: name, what, when
  "booking-confirmed": (data) => ({
    subject: "Your booking is confirmed",
    text: [
      `Hello ${line(data, "name")},`,
      "",
      `You're booked in: ${line(data, "what")}, ${line(data, "when")}.`,
      "",
      "Thank you.",
    ].join("\n"),
  }),
  // data: name, group, by
  "added-to-group": (data) => ({
    subject: "You were added to a group",
    text: [
      `Hello ${line(data, "name")},`,
      "",
      `${line(data, "by")} added you to ${line(data, "group")}.`,
      "",
      "Sign in to see it.",
    ].join("\n"),
  }),
};

/** The message for `template` with `data`. Unknown: a mistake in code. */
export function render(template: string, data: Data = {}): Message {
  if (!Object.hasOwn(TEMPLATES, template))
    throw new TypeError(`No email template named ${template}`);
  const made = (TEMPLATES[template] as (data: Data) => Message)(data);
  return {
    subject: made.subject.replace(/\s+/gu, " ").trim().slice(0, 150),
    text: made.text.slice(0, 10_000),
  };
}
