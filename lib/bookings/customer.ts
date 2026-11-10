// A customer's own account (role "member", from public sign-up): the bookings they made while signed in, or saved
// from a manage link. Every query is scoped to the signed-in account's id. Bookings are never matched by email:
// no email address here is verified, so an email match would show one person's bookings to another.
import { siteName } from "../../app/site";
import { requireRole } from "../roles/runtime";
import { accountRuntime, database, sessionSecret } from "../runtime";
import { businessName } from "./notify";
import { managePath } from "./public";
import { createStaffApi } from "./staff";
import { bookingsOfCustomer, getBusiness } from "./store";
import { signManageToken } from "./token";

const staffApi = createStaffApi({ db: database, requireRole });

/** GET /api/me/bookings */
export async function myBookings(request: Request) {
  const user = await accountRuntime().requireUser(request);
  const db = database();
  const [list, business, staff] = await Promise.all([
    bookingsOfCustomer(db, user.id),
    getBusiness(db),
    // Whether this account works here, so the page can point to their own day (the same check that page makes).
    staffApi.person(request).then(
      () => true,
      () => false,
    ),
  ]);
  const secret = sessionSecret();
  return {
    user,
    staff,
    business: {
      name: businessName(business, siteName),
      timeZone: business.timeZone,
      currency: business.currency,
    },
    bookings: list.map(({ manageNonce, customerId: _customer, ...booking }) => ({
      ...booking,
      manageUrl: managePath(signManageToken(booking.id, manageNonce, secret)),
    })),
  };
}
