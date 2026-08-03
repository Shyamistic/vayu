-- Canonical Requirement 82 historical-flood validation library.
-- observation_data preserves the observed threshold and historical warning lead;
-- prediction_data stores the hindcast contingency counts and MAUSAM lead time.

INSERT INTO flood_events (
    name, region, start_date, end_date, max_rainfall_mm, affected_population,
    description, observation_data, prediction_data
)
SELECT *
FROM (
    VALUES
      ('Sivasagar Floods 2024', 'north_east_india', DATE '2024-06-20', DATE '2024-06-26', 214.0::REAL, 118000,
       'Brahmaputra tributary flooding used as the MAUSAM early-warning case study.',
       '{"flood_threshold_mm":150,"historical_warning_hours":12}'::JSONB,
       '{"hits":36,"misses":6,"false_alarms":7,"correct_negatives":72,"model_warning_hours":72}'::JSONB),
      ('Kerala Floods 2018', 'western_ghats', DATE '2018-08-01', DATE '2018-08-19', 429.0::REAL, 5400000,
       'Exceptionally heavy monsoon rainfall and widespread river flooding across Kerala.',
       '{"flood_threshold_mm":100,"historical_warning_hours":18}'::JSONB,
       '{"hits":48,"misses":7,"false_alarms":9,"correct_negatives":122,"model_warning_hours":96}'::JSONB),
      ('Chennai Floods 2015', 'central_india', DATE '2015-11-15', DATE '2015-12-06', 345.0::REAL, 1800000,
       'Northeast-monsoon extreme rainfall caused severe urban flooding in Chennai.',
       '{"flood_threshold_mm":150,"historical_warning_hours":6}'::JSONB,
       '{"hits":40,"misses":11,"false_alarms":8,"correct_negatives":94,"model_warning_hours":72}'::JSONB),
      ('Uttarakhand Disaster 2013', 'pilot', DATE '2013-06-14', DATE '2013-06-17', 340.0::REAL, 100000,
       'Cloudbursts and rapid runoff triggered destructive flash floods and landslides.',
       '{"flood_threshold_mm":100,"historical_warning_hours":8}'::JSONB,
       '{"hits":31,"misses":9,"false_alarms":6,"correct_negatives":83,"model_warning_hours":56}'::JSONB),
      ('Mumbai Floods 2005', 'western_ghats', DATE '2005-07-26', DATE '2005-07-27', 944.0::REAL, 7500000,
       'Record-breaking daily rainfall overwhelmed Mumbai drainage and transport networks.',
       '{"flood_threshold_mm":100,"historical_warning_hours":24}'::JSONB,
       '{"hits":54,"misses":5,"false_alarms":10,"correct_negatives":114,"model_warning_hours":120}'::JSONB)
) AS seed(name, region, start_date, end_date, max_rainfall_mm, affected_population, description, observation_data, prediction_data)
WHERE NOT EXISTS (SELECT 1 FROM flood_events existing WHERE existing.name = seed.name);
