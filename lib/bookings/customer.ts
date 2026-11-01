// A customer's own account (role "member", from public sign-up): the bookings they made while signed in, or saved
// from a manage link. Every query is scoped to the signed-in account's id. Bookings are never matched by email:
// no email address here is verified, so an email match would show one person's bookings to another.
import { siteName } from "../../app/site";
import { accountRuntime, database, sessionSecret } from "../runtime";
import { businessName } from "./notify";
import { managePath } from "./public";
import { bookingsOfCustomer, getBusiness } from "./store";
import { signManageToken } from "./token";

/** GET /api/me/bookings */
export async function myBookings(request: Request) {
  const user = await accountRuntime().requireUser(request);
  const db = database();
  const [list, business] = await Promise.all([bookingsOfCustomer(db, user.id), getBusiness(db)]);
  const secret = sessionSecret();
  return {
    user,
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
