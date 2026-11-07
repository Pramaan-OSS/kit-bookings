-- Deleting an account (the starter's owner-address release of a member who never confirmed their address) failed on
-- this key, which had no ON DELETE rule. CASCADE, not SET NULL: user_id is in the primary key, and a place held by nobody
-- would keep counting against the class's capacity. The place frees up for someone else. bookings.customer_id already
-- has SET NULL: a booking is the business's record of who is coming, with the customer's name and email copied in.
ALTER TABLE class_places
  DROP CONSTRAINT class_places_user_id_fkey,
  ADD CONSTRAINT class_places_user_id_fkey FOREIGN KEY (user_id) REFERENCES app_users(id) ON DELETE CASCADE;
