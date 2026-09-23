'use strict';

/**
 * Esquema de la base de datos del club.
 *
 * Vive aparte de `db.js` para que las pruebas puedan crear la misma estructura
 * sin abrir una conexión de la aplicación.
 *
 * `match_*` cuelgan de `matches` con borrado en cascada: retirar la alineación
 * de un día se limpia solo, igual que antes hacía `unpublishMatch`.
 */

const DDL = `
CREATE TABLE IF NOT EXISTS settings (
  key         text PRIMARY KEY,
  value       text NOT NULL,
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS players (
  id             text PRIMARY KEY,
  number         text NOT NULL DEFAULT '',
  username       text NOT NULL,
  display_name   text NOT NULL,
  position       text NOT NULL,
  photo          text,
  is_admin       boolean NOT NULL DEFAULT false,
  is_player      boolean NOT NULL DEFAULT true,
  sort_order     integer NOT NULL DEFAULT 0,
  claimed        boolean NOT NULL DEFAULT false,
  password_salt  text NOT NULL,
  password_hash  text NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS players_username_key ON players (lower(username));

-- Un miembro puede ser administrador Y jugador a la vez (el mánager que también
-- juega). Antes is_admin servía para las dos cosas y excluía de la plantilla,
-- así que un jugador al que se le daban permisos desaparecía de las cartas.
-- is_player separa las dos ideas: la cuenta técnica de admin no es jugador.
ALTER TABLE players ADD COLUMN IF NOT EXISTS is_player boolean NOT NULL DEFAULT true;
-- Las cuentas que ya existían con is_admin y la posición 'ADMIN' son la cuenta
-- técnica sembrada, no un jugador al que se le dieron permisos.
UPDATE players SET is_player = false WHERE is_admin AND position = 'ADMIN';

CREATE TABLE IF NOT EXISTS lineup (
  id          boolean PRIMARY KEY DEFAULT true CHECK (id),
  formation   text NOT NULL DEFAULT '4-3-3',
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS lineup_items (
  player_id  text NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  x          double precision NOT NULL,
  y          double precision NOT NULL,
  vertical   boolean NOT NULL DEFAULT true,
  position   integer NOT NULL DEFAULT 0,
  PRIMARY KEY (player_id)
);

CREATE TABLE IF NOT EXISTS matches (
  date          date PRIMARY KEY,
  formation     text NOT NULL DEFAULT '4-3-3',
  note          text NOT NULL DEFAULT '',
  clean_sheet   boolean NOT NULL DEFAULT false,
  published_at  timestamptz,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS match_items (
  match_date  date NOT NULL REFERENCES matches(date) ON DELETE CASCADE,
  player_id   text NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  x           double precision NOT NULL,
  y           double precision NOT NULL,
  vertical    boolean NOT NULL DEFAULT true,
  position    integer NOT NULL DEFAULT 0,
  PRIMARY KEY (match_date, player_id)
);

CREATE TABLE IF NOT EXISTS match_stats (
  match_date  date NOT NULL REFERENCES matches(date) ON DELETE CASCADE,
  player_id   text NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  goals       integer NOT NULL DEFAULT 0,
  assists     integer NOT NULL DEFAULT 0,
  PRIMARY KEY (match_date, player_id)
);

CREATE TABLE IF NOT EXISTS match_ballots (
  match_date  date NOT NULL REFERENCES matches(date) ON DELETE CASCADE,
  voter_id    text NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (match_date, voter_id)
);

CREATE TABLE IF NOT EXISTS match_scores (
  match_date  date NOT NULL,
  voter_id    text NOT NULL,
  target_id   text NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  score       integer NOT NULL,
  PRIMARY KEY (match_date, voter_id, target_id),
  FOREIGN KEY (match_date, voter_id)
    REFERENCES match_ballots(match_date, voter_id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS checkin_days (
  date        date PRIMARY KEY,
  note        text NOT NULL DEFAULT '',
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS checkins (
  date        date NOT NULL REFERENCES checkin_days(date) ON DELETE CASCADE,
  player_id   text NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  status      text NOT NULL,
  message     text NOT NULL DEFAULT '',
  updated_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (date, player_id)
);

CREATE TABLE IF NOT EXISTS history (
  id          text PRIMARY KEY,
  title       text NOT NULL,
  date        text NOT NULL,
  body        text NOT NULL DEFAULT '',
  image       text,
  pinned      boolean NOT NULL DEFAULT false,
  position    integer NOT NULL DEFAULT 0,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS sessions (
  sid      text PRIMARY KEY,
  data     jsonb NOT NULL,
  expires  bigint
);
CREATE INDEX IF NOT EXISTS sessions_expires_idx ON sessions (expires);
`;

module.exports = { DDL };
