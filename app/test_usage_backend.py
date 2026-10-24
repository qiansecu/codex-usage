import json
import tempfile
import unittest
from pathlib import Path
from usage_backend import Backend

A = '11111111-1111-7111-8111-111111111111'
B = '22222222-2222-7222-8222-222222222222'
TURN = '33333333-3333-7333-8333-333333333333'


def usage(input_tokens, output_tokens, cached=0):
    return {'input_tokens': input_tokens, 'output_tokens': output_tokens,
            'cached_input_tokens': cached, 'total_tokens': input_tokens + output_tokens}


def events(thread, amount):
    return [
        {'type': 'session_meta', 'payload': {'id': thread}},
        {'type': 'event_msg', 'payload': {'type': 'task_started', 'turn_id': TURN}},
        {'type': 'event_msg', 'payload': {'type': 'token_count', 'info': {
            'last_token_usage': usage(90, 30), 'model_context_window': 100}}},
        {'type': 'token_usage_record', 'payload': {'thread_id': thread, 'turn_id': TURN,
            'response_id': 'response-1', 'usage': amount, 'thread_token_usage': amount,
            'turn_token_usage': amount}},
    ]


class BackendTests(unittest.TestCase):
    def setUp(self):
        self.test_root = Path(__file__).resolve().parent / 'runtime' / 'test-fixtures'
        self.test_root.mkdir(parents=True, exist_ok=True)
        self.temp = tempfile.TemporaryDirectory(dir=self.test_root)
        self.home = Path(self.temp.name)
        (self.home / 'sessions').mkdir()
        self.backend = Backend(self.home)

    def tearDown(self):
        self.assertTrue(self.home.resolve().is_relative_to(self.test_root.resolve()))
        self.temp.cleanup()

    def write(self, thread, records):
        file = self.home / 'sessions' / f'rollout-test-{thread}.jsonl'
        file.write_text(''.join(json.dumps(record) + '\n' for record in records), encoding='utf-8')
        return file

    def test_two_sessions_and_context_clamp(self):
        self.write(A, events(A, usage(200, 20, 50)))
        self.write(B, events(B, usage(30, 10)))
        a, b = self.backend.get(A), self.backend.get(B)
        self.assertEqual(a['reportedUsage']['total_tokens'], 220)
        self.assertEqual(b['reportedUsage']['total_tokens'], 40)
        self.assertEqual(a['cachePercent'], 25)
        self.assertEqual(a['contextPercent'], 100)

    def test_incremental_completion_and_duplicate_deduplication(self):
        records = events(A, usage(200, 20))
        file = self.write(A, records)
        self.assertEqual(self.backend.get(A)['turns'][0]['status'], 'in_progress')
        with file.open('a', encoding='utf-8') as stream:
            stream.write(json.dumps(records[-1]) + '\n')
            stream.write(json.dumps({'type': 'event_msg', 'timestamp': '2026-10-14T12:00:00Z', 'payload': {'type': 'task_complete', 'turn_id': TURN}}) + '\n')
        snapshot = self.backend.get(A)
        self.assertEqual(snapshot['steps'], 1)
        self.assertEqual(snapshot['turns'][0]['status'], 'completed')

    def test_metadata_mismatch_and_invalid_id(self):
        self.write(A, events(B, usage(200, 20)))
        self.assertEqual(self.backend.get(A)['sourceState'], 'identity-mismatch')
        self.assertEqual(self.backend.get('../auth.json')['sourceState'], 'unbound')

    def test_missing_session_never_falls_back_to_another(self):
        self.write(A, events(A, usage(200, 20)))
        self.assertEqual(self.backend.get(B)['sourceState'], 'missing')

    def test_turn_model_history_and_optional_usage_availability(self):
        records = events(A, usage(200, 20))
        records[0]['payload']['model_provider'] = 'openai_http'
        records.insert(2, {'type': 'turn_context', 'payload': {'turn_id': TURN, 'model': 'past-model'}})
        records.insert(3, {'type': 'turn_context', 'payload': {'turn_id': TURN, 'model': 'second-model'}})
        file = self.write(A, records)
        turn = self.backend.get(A)['turns'][0]
        self.assertEqual(turn['models'], ['past-model', 'second-model'])
        self.assertEqual(turn['provider'], 'openai_http')
        self.assertFalse(turn['cacheWriteAvailable'])
        updated = records[-1]
        updated['payload']['turn_token_usage']['cache_write_input_tokens'] = 0
        with file.open('a', encoding='utf-8') as stream:
            stream.write(json.dumps(updated) + '\n')
        turn = self.backend.get(A)['turns'][0]
        self.assertTrue(turn['cacheWriteAvailable'])
        self.assertEqual(turn['usage']['cache_write_input_tokens'], 0)

    def test_performance_deduplicates_items_unions_model_activity_and_averages_valid_ttft(self):
        records = events(A, usage(200, 20))
        def item(kind, item_id, start, finish, extra=None):
            return {'type': 'event_msg', 'payload': {'type': 'item_completed', 'thread_id': A, 'turn_id': TURN,
                    'started_at_ms': start, 'completed_at_ms': finish, 'item': {'type': kind, 'id': item_id, **(extra or {})}}}
        command = item('CommandExecution', 'tool-1', 100, 200, {'duration': {'secs': 2, 'nanos': 500000000}})
        records += [item('Reasoning', 'model-1', 0, 1000), item('AgentMessage', 'model-2', 500, 1500),
                    command, command, item('McpToolCall', 'tool-2', 200, 1200)]
        done = {'type': 'event_msg', 'timestamp': '2026-10-17T00:00:00Z', 'payload':
                {'type': 'task_complete', 'turn_id': TURN, 'time_to_first_token_ms': 1000, 'error': None}}
        records += [done, done, {'type': 'event_msg', 'payload': {'type': 'task_complete', 'turn_id': 'second', 'time_to_first_token_ms': 3000}},
                    {'type': 'event_msg', 'payload': {'type': 'task_complete', 'turn_id': 'failed', 'time_to_first_token_ms': 500, 'error': 'failed'}}]
        self.write(A, records)
        stats = self.backend.get(A)['performance']
        self.assertEqual(stats['modelActiveMs'], 1500)
        self.assertEqual(stats['modelActivitySamples'], 2)
        self.assertEqual(stats['toolTotalMs'], 3500)
        self.assertEqual(stats['toolSamples'], 2)
        self.assertEqual(stats['ttftAverageMs'], 2000)
        self.assertEqual(stats['ttftSamples'], 2)
        self.assertEqual(self.backend.get(A)['performance'], stats)

    def test_missing_performance_is_unknown_and_explicit_zero_is_preserved(self):
        file = self.write(A, events(A, usage(20, 2)))
        stats = self.backend.get(A)['performance']
        self.assertIsNone(stats['toolTotalMs'])
        self.assertIsNone(stats['modelActiveMs'])
        self.assertIsNone(stats['ttftAverageMs'])
        records = [
            {'type': 'event_msg', 'payload': {'type': 'task_complete', 'turn_id': TURN, 'time_to_first_token_ms': 0}},
            {'type': 'event_msg', 'payload': {'type': 'item_completed', 'thread_id': A, 'turn_id': TURN,
                'item': {'type': 'Extension', 'id': 'instant', 'durationMs': 0}}},
            {'type': 'event_msg', 'payload': {'type': 'item_completed', 'thread_id': B, 'turn_id': TURN,
                'started_at_ms': 0, 'completed_at_ms': 99999, 'item': {'type': 'AgentMessage', 'id': 'wrong-thread'}}},
        ]
        with file.open('a', encoding='utf-8') as stream:
            stream.write(''.join(json.dumps(record) + '\n' for record in records))
        stats = self.backend.get(A)['performance']
        self.assertEqual(stats['toolTotalMs'], 0)
        self.assertEqual(stats['ttftAverageMs'], 0)
        self.assertIsNone(stats['modelActiveMs'])


    def continuation(self, origin=0):
        records = events(A, usage(200, 20, 50))
        if origin:
            records[0]['payload']['history_base'] = {'thread_id': B, 'end_ordinal_exclusive': origin}
        base = self.write(A, records)
        boundary = base.stat().st_size
        with base.open('a', encoding='utf-8') as stream:
            stream.write(json.dumps({'type': 'event_msg', 'payload': {'type': 'task_started', 'turn_id': 'discarded'}}) + '\n')
        newer = events(A, usage(30, 10, 10))
        newer[0]['payload'].update(history_mode='paginated', history_base={
            'thread_id': A, 'end_byte_offset': boundary, 'end_ordinal_exclusive': origin + len(records)})
        for event in newer:
            payload = event['payload']
            if 'turn_id' in payload: payload['turn_id'] = B
        newer[-1]['payload'].update(response_id='response-2', thread_token_usage=usage(230, 30, 60))
        page = self.home / 'sessions' / f'rollout-test-{A}_{TURN}.jsonl'
        page.write_text(''.join(json.dumps(record) + '\n' for record in newer), encoding='utf-8')
        return base, page, newer

    def test_paginated_same_thread_keeps_exact_prefix_and_incremental_usage(self):
        base, page, records = self.continuation()
        result = self.backend.get(A)
        self.assertEqual(result['sourceState'], 'ready')
        self.assertTrue(result['accountingMatches'])
        self.assertEqual(result['reportedUsage']['total_tokens'], 260)
        self.assertEqual(result['recordedTurns'], 2)
        self.assertEqual({t['id'] for t in result['turns']}, {TURN, B})
        self.assertEqual(result['steps'], 2)
        with page.open('a', encoding='utf-8') as stream:
            stream.write(json.dumps(records[-1]) + '\n')
        self.assertEqual(self.backend.get(A)['steps'], 2)
        base.unlink()
        self.assertEqual(self.backend.get(A)['sourceState'], 'missing')

    def test_paginated_ordinal_can_start_after_inherited_history(self):
        self.continuation(origin=13)
        self.assertTrue(self.backend.get(A)['accountingMatches'])
        self.assertEqual(self.backend.get(A)['recordedTurns'], 2)

    def test_paginated_bad_identity_and_boundaries_do_not_reuse_legacy_data(self):
        _, page, records = self.continuation()
        for change, state in [({'id': B}, 'identity-mismatch'),
                              ({'history_base': {'thread_id': B, 'end_byte_offset': 10, 'end_ordinal_exclusive': 4}}, 'read-error'),
                              ({'history_base': {'thread_id': A, 'end_byte_offset': 10, 'end_ordinal_exclusive': 4}}, 'read-error'),
                              ({'history_base': {'thread_id': A, 'end_byte_offset': 999999, 'end_ordinal_exclusive': 4}}, 'read-error')]:
            modified = json.loads(json.dumps(records))
            modified[0]['payload'].update(change)
            page.write_text(''.join(json.dumps(record) + '\n' for record in modified), encoding='utf-8')
            self.assertEqual(self.backend.get(A)['sourceState'], state)

    def test_multiple_continuations_are_ambiguous_instead_of_selecting_newest(self):
        _, page, _ = self.continuation()
        other = page.with_name(f'rollout-test-{A}_{B}.jsonl')
        other.write_bytes(page.read_bytes())
        self.assertEqual(self.backend.get(A)['sourceState'], 'ambiguous')


if __name__ == '__main__':
    unittest.main()
