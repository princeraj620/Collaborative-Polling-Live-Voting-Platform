-- =====================================================================
-- PollPulse seed data
--   * 1 demo creator
--   * 10 featured polls (fixed ids so scripts and load tests can find them)
--   * 200,000 historical (closed) polls so indexing and search have real
--     work to do. See scripts/index-benchmark.mjs.
-- =====================================================================

INSERT INTO users (id, email, name) VALUES
  ('c0000000-0000-4000-8000-000000000001', 'team@pollpulse.dev', 'PollPulse Team');

-- ---------------------------------------------------------------------
-- Featured polls (open for 30 days from the moment you seed)
-- ---------------------------------------------------------------------
INSERT INTO polls (id, question, description, category, creator_id, created_at, closes_at) VALUES
  ('b0000000-0000-4000-8000-000000000001', 'Who should win tonight''s Talent Show final?',
   'The live TV vote. Lines are open now. This is the poll the load tests hammer.', 'entertainment',
   'c0000000-0000-4000-8000-000000000001', now(), now() + interval '30 days'),
  ('b0000000-0000-4000-8000-000000000002', 'Which programming language should a beginner learn first?',
   'You get one pick. Think about your first year of coding.', 'tech',
   'c0000000-0000-4000-8000-000000000001', now() - interval '1 minute', now() + interval '30 days'),
  ('b0000000-0000-4000-8000-000000000003', 'Tabs or spaces?',
   'The oldest debate in programming.', 'tech',
   'c0000000-0000-4000-8000-000000000001', now() - interval '2 minutes', now() + interval '30 days'),
  ('b0000000-0000-4000-8000-000000000004', 'What is the best Indian street food?',
   'Only one answer counts. Choose wisely.', 'food',
   'c0000000-0000-4000-8000-000000000001', now() - interval '3 minutes', now() + interval '30 days'),
  ('b0000000-0000-4000-8000-000000000005', 'Mountains or beaches for your next trip?',
   'Where would you rather wake up?', 'travel',
   'c0000000-0000-4000-8000-000000000001', now() - interval '4 minutes', now() + interval '30 days'),
  ('b0000000-0000-4000-8000-000000000006', 'Are you a morning person or a night owl?',
   'Be honest.', 'lifestyle',
   'c0000000-0000-4000-8000-000000000001', now() - interval '5 minutes', now() + interval '30 days'),
  ('b0000000-0000-4000-8000-000000000007', 'Tea or coffee? (closes 20 minutes after setup)',
   'Watch this poll close by itself: the worker recounts every vote and publishes exact final results.', 'food',
   'c0000000-0000-4000-8000-000000000001', now() - interval '6 minutes', now() + interval '20 minutes'),
  ('b0000000-0000-4000-8000-000000000008', 'What is the best way to learn system design?',
   'Asking for a friend who is building five projects.', 'tech',
   'c0000000-0000-4000-8000-000000000001', now() - interval '7 minutes', now() + interval '30 days'),
  ('b0000000-0000-4000-8000-000000000009', 'Which feature should PollPulse build next?',
   'Your vote shapes the roadmap.', 'general',
   'c0000000-0000-4000-8000-000000000001', now() - interval '8 minutes', now() + interval '30 days');

INSERT INTO options (poll_id, id, label) VALUES
  ('b0000000-0000-4000-8000-000000000001', 1, 'Aria Sen (singer)'),
  ('b0000000-0000-4000-8000-000000000001', 2, 'The Kolkata Beats (band)'),
  ('b0000000-0000-4000-8000-000000000001', 3, 'Rohan Mehta (magician)'),
  ('b0000000-0000-4000-8000-000000000001', 4, 'Zoya & Kabir (dancers)'),
  ('b0000000-0000-4000-8000-000000000002', 1, 'Python'),
  ('b0000000-0000-4000-8000-000000000002', 2, 'JavaScript'),
  ('b0000000-0000-4000-8000-000000000002', 3, 'C++'),
  ('b0000000-0000-4000-8000-000000000002', 4, 'Java'),
  ('b0000000-0000-4000-8000-000000000003', 1, 'Tabs'),
  ('b0000000-0000-4000-8000-000000000003', 2, 'Spaces'),
  ('b0000000-0000-4000-8000-000000000003', 3, 'Whatever the formatter says'),
  ('b0000000-0000-4000-8000-000000000004', 1, 'Pani puri'),
  ('b0000000-0000-4000-8000-000000000004', 2, 'Vada pav'),
  ('b0000000-0000-4000-8000-000000000004', 3, 'Momos'),
  ('b0000000-0000-4000-8000-000000000004', 4, 'Chole bhature'),
  ('b0000000-0000-4000-8000-000000000004', 5, 'Masala dosa'),
  ('b0000000-0000-4000-8000-000000000005', 1, 'Mountains'),
  ('b0000000-0000-4000-8000-000000000005', 2, 'Beaches'),
  ('b0000000-0000-4000-8000-000000000006', 1, 'Morning person'),
  ('b0000000-0000-4000-8000-000000000006', 2, 'Night owl'),
  ('b0000000-0000-4000-8000-000000000006', 3, 'Depends on the coffee'),
  ('b0000000-0000-4000-8000-000000000007', 1, 'Tea'),
  ('b0000000-0000-4000-8000-000000000007', 2, 'Coffee'),
  ('b0000000-0000-4000-8000-000000000008', 1, 'Read books'),
  ('b0000000-0000-4000-8000-000000000008', 2, 'Build projects'),
  ('b0000000-0000-4000-8000-000000000008', 3, 'Watch videos'),
  ('b0000000-0000-4000-8000-000000000008', 4, 'Mock interviews'),
  ('b0000000-0000-4000-8000-000000000009', 1, 'Dark mode for charts'),
  ('b0000000-0000-4000-8000-000000000009', 2, 'Ranked-choice voting'),
  ('b0000000-0000-4000-8000-000000000009', 3, 'Poll comments'),
  ('b0000000-0000-4000-8000-000000000009', 4, 'Embeddable widgets');

-- A closed poll with published final results, to show the "closed" view.
INSERT INTO polls (id, question, description, category, creator_id, status, created_at, closes_at, closed_at, vote_count, final_results)
VALUES ('b0000000-0000-4000-8000-000000000010', 'What is your favourite season?',
  'A finished poll. Its results were counted exactly when it closed.', 'lifestyle',
  'c0000000-0000-4000-8000-000000000001', 'CLOSED',
  now() - interval '40 days', now() - interval '10 days', now() - interval '10 days', 4820,
  '{"total": 4820, "liveTotal": 4817, "drift": 3,
    "options": [{"optionId": 1, "label": "Winter", "count": 1702},
                {"optionId": 2, "label": "Monsoon", "count": 1455},
                {"optionId": 3, "label": "Spring", "count": 1033},
                {"optionId": 4, "label": "Summer", "count": 630}],
    "byRegion": {"mumbai": 2210, "frankfurt": 1406, "virginia": 1204}}');
INSERT INTO options (poll_id, id, label) VALUES
  ('b0000000-0000-4000-8000-000000000010', 1, 'Winter'),
  ('b0000000-0000-4000-8000-000000000010', 2, 'Monsoon'),
  ('b0000000-0000-4000-8000-000000000010', 3, 'Spring'),
  ('b0000000-0000-4000-8000-000000000010', 4, 'Summer');

-- ---------------------------------------------------------------------
-- 200,000 historical polls (all closed, created over the past year).
-- Questions are generated from word lists so full-text search has
-- realistic words to find: try "python", "coffee", "train", "chess".
-- ---------------------------------------------------------------------
WITH words AS (
  SELECT
    ARRAY['Do you prefer', 'Would you try', 'Is it worth learning', 'Should cities invest in',
          'How often do you use', 'Would you recommend', 'Is it time to switch to', 'Do you trust'] AS starters,
    ARRAY['Python', 'JavaScript', 'Rust', 'Go', 'electric scooters', 'remote work', 'night trains',
          'street food', 'home cooking', 'public libraries', 'solar panels', 'online courses',
          'board games', 'podcasts', 'audiobooks', 'smart watches', 'mechanical keyboards', 'dark mode',
          'open source tools', 'meal planning', 'yoga', 'running clubs', 'cycling lanes', 'train travel',
          'budget airlines', 'hostels', 'camping', 'coffee', 'green tea', 'filter coffee', 'cricket',
          'football', 'chess', 'badminton', 'local markets', 'vinyl records', 'e-readers',
          'note-taking apps', 'standing desks', 'pair programming'] AS subjects,
    ARRAY['tech', 'tech', 'tech', 'tech', 'lifestyle', 'lifestyle', 'travel', 'food', 'food', 'general',
          'general', 'tech', 'entertainment', 'entertainment', 'entertainment', 'tech', 'tech', 'tech',
          'tech', 'food', 'lifestyle', 'lifestyle', 'travel', 'travel', 'travel', 'travel', 'travel',
          'food', 'food', 'food', 'sports', 'sports', 'sports', 'sports', 'food', 'entertainment', 'tech',
          'tech', 'tech', 'tech'] AS categories,
    ARRAY['', ' in 2026', ' this year', ' every day', ' for beginners', ' at work'] AS endings
),
gen AS (
  SELECT g,
         1 + floor(random() * 8)::int                    AS s,
         1 + floor(random() * 40)::int                   AS t,
         1 + floor(random() * 6)::int                    AS e,
         now() - interval '31 days' - (random() * interval '330 days') AS created_at,
         (1 + floor(random() * 30))::int                 AS days,
         floor(random() * random() * 5000)::int          AS votes,
         random()                                        AS split
  FROM generate_series(1, 200000) AS g
),
inserted AS (
  INSERT INTO polls (question, description, category, creator_id, status, visibility,
                     created_at, closes_at, closed_at, vote_count, final_results)
  SELECT w.starters[s] || ' ' || w.subjects[t] || w.endings[e] || '?',
         'Community poll #' || g,
         w.categories[t],
         'c0000000-0000-4000-8000-000000000001',
         'CLOSED',
         CASE WHEN g % 10 = 0 THEN 'unlisted' ELSE 'public' END,
         created_at,
         created_at + make_interval(days => days),
         created_at + make_interval(days => days),
         votes,
         jsonb_build_object(
           'total', votes, 'liveTotal', votes, 'drift', 0,
           'options', jsonb_build_array(
             jsonb_build_object('optionId', 1, 'label', 'Yes', 'count', floor(votes * split)::int),
             jsonb_build_object('optionId', 2, 'label', 'No', 'count', votes - floor(votes * split)::int)),
           'byRegion', jsonb_build_object('mumbai', votes / 2, 'frankfurt', votes / 4,
                                          'virginia', votes - votes / 2 - votes / 4))
  FROM gen, words w
  RETURNING id
)
INSERT INTO options (poll_id, id, label)
SELECT inserted.id, o.id, o.label
FROM inserted, (VALUES (1::smallint, 'Yes'), (2::smallint, 'No')) AS o(id, label);

ANALYZE polls;
ANALYZE options;
