SET LOCAL lock_timeout = '5s';

ALTER TABLE relay_commands
  VALIDATE CONSTRAINT relay_commands_protocol1_tuple_check;
