import { database } from "../roles/database";
import { requireRole } from "../roles/runtime";
import { createNoticesApi } from "./api";
import { emailDoor } from "./door";
import { createNotifier } from "./notify";

let made:
  | { notifier: ReturnType<typeof createNotifier>; api: ReturnType<typeof createNoticesApi> }
  | undefined;

function parts() {
  if (!made) {
    const notifier = createNotifier({ db: database, door: emailDoor });
    made = {
      notifier,
      api: createNoticesApi({ db: database, door: emailDoor, notifier, requireRole }),
    };
  }
  return made;
}

/**
 * Sends one email once per event, from any server route or job after the thing it tells about is saved:
 * `await notify({ template: "booking-confirmed", event: `booking:${id}`, to: email, data: { name, what, when } })`.
 * It never throws for an outcome (email off, a refusal): read the result if the page should say what happened.
 */
export const notify = (notice: Parameters<ReturnType<typeof createNotifier>["notify"]>[0]) =>
  parts().notifier.notify(notice);

/** The owner's page API (app/api/email-notices). */
export const noticesApi = () => parts().api;
