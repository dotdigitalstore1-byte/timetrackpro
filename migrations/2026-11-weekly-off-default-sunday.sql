-- New companies now start with Sunday as the only weekly off (it used to be Saturday and Sunday).
-- Safe to re-run. This changes the default for NEW companies only: existing companies keep the weekly offs they
-- have today. An admin removes Saturday (or adds any other day) on the Rules page > Weekly offs & paid holidays.

ALTER TABLE company_settings ALTER COLUMN weekly_off SET DEFAULT '0';
