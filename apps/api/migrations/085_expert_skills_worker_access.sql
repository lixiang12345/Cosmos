SET LOCAL lock_timeout = '5s';

-- The execution worker assembles the system prompt for a claimed attempt and
-- must read the inline Skill packages an Expert revision pins. Mirrors the
-- worker read access the other configuration tables received in 047.
GRANT SELECT ON cosmos_skills TO cosmos_worker_runtime;

CREATE POLICY cosmos_worker_skill_select ON cosmos_skills
  FOR SELECT TO cosmos_worker_runtime USING (true);
