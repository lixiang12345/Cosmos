SET LOCAL lock_timeout = '5s';

ALTER TABLE cosmos_commands
  VALIDATE CONSTRAINT cosmos_commands_protocol1_tuple_check;
