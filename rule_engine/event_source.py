"""
EventSource implementations for file and stdin.
"""
import json
from typing import Iterator
from abc import ABC, abstractmethod
from .event import DeviceEvent
import sys


class EventSource(ABC):
    """Abstract base class for event sources."""

    @abstractmethod
    def events(self) -> Iterator[DeviceEvent]:
        """
        Yield events from the source.

        Yields:
            DeviceEvent instances.
        """
        pass


class FileEventSource(EventSource):
    """
    Event source that reads events from a JSON lines file.
    Each line should be a valid JSON object representing one event.
    """

    def __init__(self, file_path: str):
        """
        Initialize the file event source.

        Args:
            file_path: Path to the JSON lines file.
        """
        self.file_path = file_path

    def events(self) -> Iterator[DeviceEvent]:
        """
        Yield events from the file.

        Yields:
            DeviceEvent instances. Invalid lines will be skipped and error printed.
        """
        with open(self.file_path, 'r', encoding='utf-8') as f:
            for line_num, line in enumerate(f, 1):
                line = line.strip()
                if not line:
                    continue
                try:
                    data = json.loads(line)
                    yield DeviceEvent.from_dict(data)
                except Exception as e:
                    print(f"Error parsing event at line {line_num}: {e}", file=sys.stderr)
                    continue


class StdinEventSource(EventSource):
    """
    Event source that reads events from standard input, line by line.
    For interactive testing.
    """

    def events(self) -> Iterator[DeviceEvent]:
        """
        Yield events from stdin.

        Yields:
            DeviceEvent instances. Invalid lines will be skipped and error printed.
        """
        for line_num, line in enumerate(sys.stdin, 1):
            line = line.strip()
            if not line:
                continue
            # Check for special commands in interactive mode
            if line.startswith('load:'):
                # Handled by main, just yield as a command
                yield None
                continue
            elif line.startswith('delete:'):
                yield None
                continue
            elif line == 'stats':
                yield None
                continue
            try:
                data = json.loads(line)
                yield DeviceEvent.from_dict(data)
            except Exception as e:
                print(f"Error parsing event at line {line_num}: {e}", file=sys.stderr)
                continue
