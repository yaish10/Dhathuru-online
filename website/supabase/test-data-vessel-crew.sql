-- Test data: speedboat SB-07 of "Coral Line Ferries (Test)" needs 1 Captain, 2 Crew and 1 Cashier on every trip.
update vessels set meta = jsonb_set(meta, '{crew_mix}', '[{"role": "Captain", "n": 1}, {"role": "Crew", "n": 2}, {"role": "Cashier", "n": 1}]')
 where company_id = (select id from companies where code = 'VY-BPWTJT') and code = 'SB-07';
select code, meta->'crew_mix' as crew_mix from vessels where company_id = (select id from companies where code = 'VY-BPWTJT') order by code;
