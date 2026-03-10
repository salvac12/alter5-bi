"""Shared utilities for Alter5 BI scripts."""

import json
import os
import tempfile


def atomic_write_json(path, data, **kwargs):
    """Write JSON to file atomically using temp file + rename.

    If the process is killed mid-write, the original file is untouched.
    The temp file is created in the same directory to ensure same filesystem
    (required for os.replace to be atomic on POSIX).
    """
    dir_ = os.path.dirname(os.path.abspath(path))
    os.makedirs(dir_, exist_ok=True)
    with tempfile.NamedTemporaryFile(
        "w", dir=dir_, suffix=".tmp", delete=False, encoding="utf-8"
    ) as tf:
        tmp_path = tf.name
        try:
            json.dump(data, tf, **kwargs)
        except Exception:
            os.unlink(tmp_path)
            raise
    os.replace(tmp_path, path)  # atomic on POSIX; near-atomic on Windows
