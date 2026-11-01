-- A starting diary, so the booking page works the moment the app opens: one person, three services and
-- weekday hours. The owner edits all of it in the owner area. Never edit this file: the draft has already run it,
-- and an edited migration restarts the draft on an empty database (go-live refuses one outright). To give the
-- founder their own services, hours and time zone, add a migration that updates these rows (0102 and up).
INSERT INTO business (id, name, tagline, time_zone, currency)
VALUES (1, '', 'Pick a time that suits you. It takes under a minute.', 'UTC', 'USD');

INSERT INTO staff (id, name, title, color, position)
VALUES ('6f1c2b4e-5a0d-4c3e-9b1a-7d2f0e8c4a01', 'Our team', '', 'evergreen', 0);

INSERT INTO services (id, name, description, duration_minutes, price_cents, buffer_before_minutes, buffer_after_minutes, position)
VALUES
  ('2b7e9c10-4f3a-4d8e-a6b2-1c5d7e9f0a11', 'First consultation',
   'A relaxed first conversation about what you need.', 30, NULL, 0, 10, 0),
  ('2b7e9c10-4f3a-4d8e-a6b2-1c5d7e9f0a12', 'Standard appointment',
   'Our usual appointment, with time to do things properly.', 60, 6000, 0, 15, 1),
  ('2b7e9c10-4f3a-4d8e-a6b2-1c5d7e9f0a13', 'Quick follow-up',
   'A short check-in after a previous visit.', 20, 2500, 0, 5, 2);

INSERT INTO staff_services (staff_id, service_id)
SELECT '6f1c2b4e-5a0d-4c3e-9b1a-7d2f0e8c4a01', id FROM services;

-- Monday to Friday, 9:00 to 17:00.
INSERT INTO weekly_hours (id, staff_id, weekday, start_minute, end_minute)
VALUES
  ('9d4a6e21-0b7c-4f5d-8e3a-2c6b8d0f1a01', '6f1c2b4e-5a0d-4c3e-9b1a-7d2f0e8c4a01', 1, 540, 1020),
  ('9d4a6e21-0b7c-4f5d-8e3a-2c6b8d0f1a02', '6f1c2b4e-5a0d-4c3e-9b1a-7d2f0e8c4a01', 2, 540, 1020),
  ('9d4a6e21-0b7c-4f5d-8e3a-2c6b8d0f1a03', '6f1c2b4e-5a0d-4c3e-9b1a-7d2f0e8c4a01', 3, 540, 1020),
  ('9d4a6e21-0b7c-4f5d-8e3a-2c6b8d0f1a04', '6f1c2b4e-5a0d-4c3e-9b1a-7d2f0e8c4a01', 4, 540, 1020),
  ('9d4a6e21-0b7c-4f5d-8e3a-2c6b8d0f1a05', '6f1c2b4e-5a0d-4c3e-9b1a-7d2f0e8c4a01', 5, 540, 1020);
