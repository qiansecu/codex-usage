"""Read-only session accounting used by the in-chat statistics backend."""
import json
import math
from collections import OrderedDict
from datetime import datetime, timezone
from pathlib import Path

FIELDS = ("input_tokens", "cached_input_tokens", "cache_write_input_tokens",
          "output_tokens", "reasoning_output_tokens", "total_tokens")
REQUIRED = ("input_tokens", "cached_input_tokens", "output_tokens", "total_tokens")


def normalized_usage(value):
    if not isinstance(value, dict) or any(k not in value for k in REQUIRED):
        return None
    result = {k: value.get(k, 0) for k in FIELDS}
    if any(type(v) is not int or v < 0 for v in result.values()):
        return None
    return result


def added(usages):
    result = dict.fromkeys(FIELDS, 0)
    for usage in usages:
        for key in FIELDS:
            result[key] += usage[key]
    return result


def union_duration(intervals):
    total = 0
    end = None
    for start, finish in sorted(intervals):
        if finish <= start:
            continue
        total += max(0, finish - max(start, end if end is not None else start))
        end = max(finish, end if end is not None else finish)
    return total


def nonnegative_number(value):
    return type(value) in (int, float) and math.isfinite(value) and value >= 0


def tool_duration(item, interval):
    value = item.get("durationMs")
    if nonnegative_number(value):
        return value
    value = item.get("duration")
    if isinstance(value, dict):
        secs, nanos = value.get("secs"), value.get("nanos")
        if type(secs) is int and secs >= 0 and type(nanos) is int and 0 <= nanos < 1000000000:
            return secs * 1000 + nanos / 1000000
    return interval[1] - interval[0] if interval else None


class Session:
    def __init__(self, config):
        self.config = config
        self.path = Path(config["path"])
        self.reset()

    def reset(self):
        self.offset = 0
        self.identity = None
        self.buffer = b""
        self.metadata = {}
        self.records = OrderedDict()
        self.turns = OrderedDict()
        self.timings = {}
        self.activity_items = {}
        self.pending_messages = []
        self.pending_tool = False
        self.context = None
        self.context_at = None
        self.context_limit = None
        self.error = None
        self.ignored_lines = 0

    def turn(self, turn_id):
        return self.turns.setdefault(turn_id, {"id": turn_id, "startedAt": None, "completedAt": None})

    def accept(self, event):
        kind, payload = event.get("type"), event.get("payload", {})
        if not isinstance(payload, dict):
            return
        if kind == "session_meta":
            self.metadata = {k: payload.get(k) for k in ("id", "forked_from_id", "model_provider")}
        elif kind == "turn_context" and payload.get("turn_id"):
            turn = self.turn(payload["turn_id"])
            model = payload.get("model")
            if isinstance(model, str) and model and model not in turn.setdefault("models", []):
                turn["models"].append(model)
        elif kind == "event_msg":
            subtype, turn_id = payload.get("type"), payload.get("turn_id")
            if subtype == "task_started" and turn_id:
                self.turn(turn_id)["startedAt"] = event.get("timestamp")
                self.pending_messages, self.pending_tool = [], False
                self.context_limit = payload.get("model_context_window") or self.context_limit
            elif subtype == "task_complete" and turn_id:
                turn = self.turn(turn_id)
                turn["completedAt"] = event.get("timestamp")
                ttft = payload.get("time_to_first_token_ms")
                if payload.get("error") is None and nonnegative_number(ttft):
                    turn["ttftMs"] = ttft
            elif subtype == "token_count" and isinstance(payload.get("info"), dict):
                info = payload["info"]
                self.context = normalized_usage(info.get("last_token_usage"))
                self.context_limit = info.get("model_context_window") or self.context_limit
                self.context_at = event.get("timestamp")
            elif subtype == "item_completed":
                item = payload.get("item", {})
                if payload.get("thread_id") not in (None, self.config["id"]) or not isinstance(item, dict):
                    return
                start, finish = payload.get("started_at_ms"), payload.get("completed_at_ms")
                interval = (start, finish) if type(start) is int and type(finish) is int and finish > start else None
                if item.get("type") == "AgentMessage":
                    if interval:
                        self.timings[item.get("id")] = interval
                if turn_id and item.get("id"):
                    kind = item.get("type")
                    if kind in ("AgentMessage", "Reasoning") and interval:
                        self.activity_items[(turn_id, kind, item["id"])] = {"model": interval}
                    elif kind in ("CommandExecution", "McpToolCall", "Extension", "FileChange", "ImageView"):
                        duration = tool_duration(item, interval)
                        if duration is not None:
                            self.activity_items[(turn_id, kind, item["id"])] = {"toolMs": duration}
        elif kind == "response_item":
            if payload.get("type") == "message" and payload.get("role") == "assistant":
                self.pending_messages.append(payload.get("id"))
            elif payload.get("type") in ("function_call", "custom_tool_call"):
                self.pending_tool = True
        elif kind == "token_usage_record":
            if payload.get("thread_id") != self.config["id"]:
                self.pending_messages, self.pending_tool = [], False
                return
            response_id, turn_id = payload.get("response_id"), payload.get("turn_id")
            usage = normalized_usage(payload.get("usage"))
            reported = normalized_usage(payload.get("thread_token_usage"))
            turn_usage = normalized_usage(payload.get("turn_token_usage"))
            if not response_id or not turn_id or usage is None or reported is None or turn_usage is None:
                self.ignored_lines += 1
                self.pending_messages, self.pending_tool = [], False
                return
            intervals = [self.timings[x] for x in self.pending_messages if x in self.timings]
            speed_sample = None
            if not self.pending_tool and intervals and len(intervals) == len(self.pending_messages):
                duration = union_duration(intervals)
                visible_output = usage["output_tokens"] - usage["reasoning_output_tokens"]
                if duration > 0 and visible_output > 0:
                    speed_sample = {"tokens": visible_output, "durationMs": duration}
            self.records[response_id] = {
                "responseId": response_id, "turnId": turn_id, "at": event.get("timestamp"),
                "usage": usage, "reported": reported, "turnUsage": turn_usage,
                "cacheWriteAvailable": "cache_write_input_tokens" in payload["turn_token_usage"],
                "reasoningAvailable": "reasoning_output_tokens" in payload["turn_token_usage"],
                "speedSample": speed_sample or self.records.get(response_id, {}).get("speedSample"),
            }
            self.turn(turn_id)
            self.pending_messages, self.pending_tool = [], False

    def update(self):
        try:
            stat = self.path.stat()
            identity = (stat.st_dev, stat.st_ino)
            if self.identity is not None and (identity != self.identity or stat.st_size < self.offset):
                self.reset()
            self.identity = identity
            if stat.st_size > self.offset:
                with self.path.open("rb") as stream:
                    stream.seek(self.offset)
                    chunk = stream.read()
                self.offset += len(chunk)
                complete = (self.buffer + chunk).split(b"\n")
                self.buffer = complete.pop()
                for line in complete:
                    if not line.strip():
                        continue
                    try:
                        self.accept(json.loads(line))
                    except (ValueError, TypeError, AttributeError):
                        self.ignored_lines += 1
            self.error = None
        except (OSError, ValueError) as error:
            self.error = type(error).__name__

    def snapshot(self):
        records = list(self.records.values())
        local = added(r["usage"] for r in records)
        reported = records[-1]["reported"] if records else None
        inherited = {k: records[0]["reported"][k] - records[0]["usage"][k] for k in FIELDS} if records else None
        accounting = bool(records) and all(inherited[k] >= 0 and inherited[k] + local[k] == reported[k] for k in FIELDS)
        cache_percent = 100 * reported["cached_input_tokens"] / reported["input_tokens"] if reported and reported["input_tokens"] else None
        context_percent = 100 * self.context["total_tokens"] / self.context_limit if self.context and type(self.context_limit) is int and self.context_limit > 0 else None
        samples = [r["speedSample"] for r in records if r["speedSample"]]
        speed = 1000 * sum(s["tokens"] for s in samples) / sum(s["durationMs"] for s in samples) if samples else None
        model_intervals = [item["model"] for item in self.activity_items.values() if "model" in item]
        tool_samples = [item["toolMs"] for item in self.activity_items.values() if "toolMs" in item]
        ttft_samples = [turn["ttftMs"] for turn in self.turns.values() if "ttftMs" in turn]
        per_turn = []
        for index, turn in enumerate(self.turns.values(), 1):
            turn_records = [r for r in records if r["turnId"] == turn["id"]]
            if not turn_records:
                continue
            summed = added(r["usage"] for r in turn_records)
            latest = turn_records[-1]
            status = "completed" if turn["completedAt"] else (
                "in_progress" if turn["id"] == next(reversed(self.turns)) else "unfinished")
            per_turn.append({**turn, "status": status, "number": index, "usage": latest["turnUsage"],
                             "provider": self.metadata.get("model_provider"),
                             "cacheWriteAvailable": latest["cacheWriteAvailable"], "reasoningAvailable": latest["reasoningAvailable"],
                             "steps": len(turn_records), "lastUsageAt": latest["at"],
                             "accountingMatches": summed == latest["turnUsage"]})
        return {
            "threadId": self.config["id"], "title": self.config["title"],
            "trackingMode": "manual_selection", "sourceError": self.error,
            "forkedFromId": self.metadata.get("forked_from_id"), "recordedTurns": len(self.turns),
            "steps": len(records), "reportedUsage": reported, "localUsage": local,
            "inheritedUsage": inherited, "accountingMatches": accounting,
            "cachePercent": cache_percent, "contextPercent": context_percent, "contextEstimated": True,
            "contextTokens": self.context["total_tokens"] if self.context else None,
            "contextWindow": self.context_limit, "contextAt": self.context_at,
            "outputSpeed": speed, "outputSpeedSamples": len(samples),
            "performance": {"modelActiveMs": union_duration(model_intervals) if model_intervals else None,
                            "modelActivitySamples": len(model_intervals),
                            "toolTotalMs": sum(tool_samples) if tool_samples else None,
                            "toolSamples": len(tool_samples),
                            "ttftAverageMs": sum(ttft_samples) / len(ttft_samples) if ttft_samples else None,
                            "ttftSamples": len(ttft_samples)},
            "speedDefinition": "纯文本响应样本的非推理输出 token ÷ 消息生成耗时；不含有工具调用的响应",
            "latestUsageAt": records[-1]["at"] if records else None,
            "latestResponseId": records[-1]["responseId"] if records else None,
            "ignoredLines": self.ignored_lines, "turns": per_turn,
        }
