"""Line-oriented, read-only statistics from the supplied Codex session directory."""
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

from usage_collector import Session

UUID = re.compile(r'^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$', re.I)


class Backend:
    def __init__(self, home):
        self.root = (Path(home) / 'sessions').resolve()
        self.sessions = {}

    def get(self, thread_id):
        base = {'threadId': thread_id, 'sampledAt': datetime.now(timezone.utc).isoformat()}
        if not isinstance(thread_id, str) or not UUID.fullmatch(thread_id):
            return {**base, 'sourceState': 'unbound'}
        paths = [p for p in self.root.rglob(f'rollout-*-{thread_id}.jsonl')
                 if p.resolve().is_relative_to(self.root)]
        pages = [p for p in self.root.rglob(f'rollout-*-{thread_id}_*.jsonl')
                 if p.resolve().is_relative_to(self.root)]
        if len(paths) != 1 or len(pages) > 1:
            return {**base, 'sourceState': 'missing' if not paths else 'ambiguous'}
        config = {'id': thread_id, 'title': thread_id, 'path': str(paths[0])}
        if pages:
            # Audited paginated rollout: one same-thread continuation and an exact byte prefix.
            # Never select the newest file, infer order from reply positions, or follow a foreign path.
            try:
                if not UUID.fullmatch(pages[0].stem.rsplit('_', 1)[-1]):
                    raise ValueError('Unsupported continuation filename')
                with pages[0].open('rb') as stream:
                    meta = json.loads(stream.readline(1024 * 1024))
                payload = meta.get('payload', {})
                history = payload.get('history_base', {})
                if meta.get('type') != 'session_meta' or payload.get('id') != thread_id:
                    return {**base, 'sourceState': 'identity-mismatch'}
                if payload.get('history_mode') != 'paginated' or history.get('thread_id') != thread_id:
                    raise ValueError('Unsupported history base')
                end = history.get('end_byte_offset')
                ordinal = history.get('end_ordinal_exclusive')
                if type(end) is not int or end <= 0 or type(ordinal) is not int or ordinal <= 0:
                    raise ValueError('Invalid history boundary')
                config.update(path=str(pages[0]), basePath=str(paths[0]), baseEnd=end, baseOrdinal=ordinal)
            except (OSError, ValueError, TypeError, AttributeError) as error:
                return {**base, 'sourceState': 'read-error', 'sourceError': type(error).__name__}
        session = self.sessions.get(thread_id)
        if session is None or session.config != config:
            session = Session(config)
            self.sessions[thread_id] = session
        session.update()
        if session.error:
            return {**base, 'sourceState': 'read-error', 'sourceError': session.error}
        if session.metadata.get('id') != thread_id:
            return {**base, 'sourceState': 'identity-mismatch'}
        snapshot = session.snapshot()
        tokens, limit = snapshot['contextTokens'], snapshot['contextWindow']
        snapshot['contextPercent'] = min(tokens, limit) / limit * 100 if (
            type(tokens) is int and tokens >= 0 and type(limit) is int and limit > 0) else None
        snapshot['trackingMode'] = 'dom_thread_id'
        snapshot['sourceState'] = 'ready' if snapshot['reportedUsage'] else 'waiting-usage'
        return {**snapshot, **base}


def main():
    backend = Backend(sys.argv[1])
    for line in sys.stdin:
        try:
            request = json.loads(line)
            result = backend.get(request.get('threadId'))
        except Exception as error:
            result = {'sourceState': 'backend-error', 'error': type(error).__name__}
        print(json.dumps(result, ensure_ascii=False), flush=True)


if __name__ == '__main__':
    main()
