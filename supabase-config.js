/**
 * public/js/supabase-config.js
 * ---------------------------------------------------------------------------
 * Connection details for the SmartSpend Supabase project.
 *
 * WHY A KEY IN THE FRONTEND IS OK
 * ------------------------------
 * The "publishable" (previously "anon") key is DESIGNED to be public. It only
 * identifies the project; it grants nothing on its own. What actually protects
 * your data is Row Level Security (RLS) inside the database: every table in
 * `supabase/schema.sql` has policies saying "a row can only be read or written
 * by the logged-in user who owns it" (auth.uid() = user_id).
 *
 * NEVER put the "service_role" / "secret" key in a frontend file. It bypasses
 * RLS completely. If you ever paste one here, treat it as compromised and
 * rotate it in the Supabase dashboard.
 * ---------------------------------------------------------------------------
 */

window.SMARTSPEND_SUPABASE = {
  url: 'https://taeldzvrcnywehuztsxf.supabase.co',
  publishableKey: 'sb_publishable_FhLgLQie51VsQrf9qeT9HA_Qa1xSh_W',

  // Where the app sends people after a successful sign-in.
  appPath: '/',
  loginPath: '/login.html',
};
