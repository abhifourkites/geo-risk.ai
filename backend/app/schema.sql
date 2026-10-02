-- The 7 tables of docs/architecture/ARCHITECTURE.md, section 3.
-- Differences from section 3 (also listed under "Changed in the build" there):
--   gleif_match has customer_id (a site's key is customer_id + os_id);
--   gleif_parent is keyed on (lei, type) (a company can have a direct and a top parent);
--   site has warnings (rule R3);
--   hazard_event has event_type, episode_id, name and date_modified, because the GDACS
--   area request needs the type and episode, and the refresh compares datemodified;
--   gleif_verdict (an 8th table) holds the verdicts given on the Company network page.
-- Every table is created only if it does not exist, so a start never resets data.
CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE IF NOT EXISTS customer (
    customer_id text PRIMARY KEY,
    name        text NOT NULL
);

CREATE TABLE IF NOT EXISTS site (
    customer_id  text NOT NULL REFERENCES customer ON DELETE CASCADE,
    os_id        text NOT NULL,              -- Open Supply Hub ID
    name         text NOT NULL,
    country_code text,
    location     geometry(Point, 4326),
    workers_est  numeric,                    -- rule R2; NULL = unknown
    list_names   text,                       -- the company's lists this site is on, " | " between names
    warnings     text[] NOT NULL DEFAULT '{}',  -- rule R3
    PRIMARY KEY (customer_id, os_id)
);
CREATE INDEX IF NOT EXISTS site_location_gix ON site USING gist (location);

CREATE TABLE IF NOT EXISTS site_owner (
    customer_id text NOT NULL,
    os_id       text NOT NULL,
    owner_name  text NOT NULL,               -- rule R4
    PRIMARY KEY (customer_id, os_id, owner_name),
    FOREIGN KEY (customer_id, os_id) REFERENCES site ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS gleif_match (
    customer_id    text NOT NULL,
    os_id          text NOT NULL,
    lei            text NOT NULL,            -- GLEIF company ID
    review_level   text NOT NULL,            -- 1 likely, 2 possible, 3 unlikely
    person_verdict text,                     -- yes, no or empty
    PRIMARY KEY (customer_id, os_id, lei),
    FOREIGN KEY (customer_id, os_id) REFERENCES site ON DELETE CASCADE
);

-- A person's verdict on one GLEIF candidate of the slice file: is this name the same company as this LEI?
-- Keyed like the file's candidates; it applies to every company the candidate links to, over the file's
-- verdict column. No row = no verdict.
CREATE TABLE IF NOT EXISTS gleif_verdict (
    kind       text NOT NULL,                -- owner or site, as in the slice file
    our_names  text NOT NULL,                -- as in the slice file, " | " between names
    lei        text NOT NULL,
    verdict    text NOT NULL CHECK (verdict IN ('yes', 'no')),
    decided_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (kind, our_names, lei)
);

CREATE TABLE IF NOT EXISTS gleif_parent (
    lei         text NOT NULL,
    parent_lei  text NOT NULL,
    parent_name text,                        -- NULL when not known; the screen shows parent_lei
    type        text NOT NULL,               -- direct, top or branch
    PRIMARY KEY (lei, type)
);

CREATE TABLE IF NOT EXISTS hazard_event (
    event_id      text PRIMARY KEY,          -- event type + GDACS event id, e.g. FL1104183
    alert_level   text NOT NULL,             -- Green, Orange, Red
    is_current    boolean NOT NULL,
    event_type    text NOT NULL,
    episode_id    integer NOT NULL,
    name          text,
    date_modified text
);

CREATE TABLE IF NOT EXISTS hazard_area (
    event_id text NOT NULL REFERENCES hazard_event ON DELETE CASCADE,
    area     geometry(Geometry, 4326) NOT NULL   -- affected areas only (rule R8)
);
CREATE INDEX IF NOT EXISTS hazard_area_gix ON hazard_area USING gist (area);
