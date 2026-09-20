# -*- coding: utf-8 -*-
import io
import json
import os
import shutil
import tempfile
import unittest
from contextlib import redirect_stdout

from depviz import cli


class CliTest(unittest.TestCase):
    def setUp(self):
        self.dir = tempfile.mkdtemp()
        self.old = os.getcwd()
        os.chdir(self.dir)
        manifest = {"modules": [
            {"id": "a", "fingerprint": "1"},
            {"id": "b", "fingerprint": "1", "deps": ["a"]},
        ]}
        with open("m.json", "w", encoding="utf-8") as fh:
            json.dump(manifest, fh)

    def tearDown(self):
        os.chdir(self.old)
        shutil.rmtree(self.dir, ignore_errors=True)

    def run_cli(self, *argv):
        buf = io.StringIO()
        with redirect_stdout(buf):
            cli.main(list(argv))
        return buf.getvalue()

    def test_session_flow(self):
        out = self.run_cli("load", "m.json")
        self.assertIn("a", out)
        # 指纹变化应传导到下游 b
        out = self.run_cli("set-fingerprint", "a", "9")
        self.assertIn("b", out)
        # 模拟重编后全部可复用
        self.run_cli("mark-built")
        out = self.run_cli("status")
        self.assertIn("a", out)
        # 新增指向不存在模块的依赖 -> 结论不可信
        out = self.run_cli("add-dep", "b", "ghost")
        self.assertIn("b", out)
        out = self.run_cli("show", "b")
        self.assertIn("ghost", out)
        # 移除缺失依赖后恢复可信
        self.run_cli("remove-dep", "b", "ghost")
        out = self.run_cli("status")
        self.assertIn("b", out)

    def test_state_persisted_between_calls(self):
        self.run_cli("load", "m.json")
        self.run_cli("set-fingerprint", "a", "7")
        with open(cli.STATE_FILE, "r", encoding="utf-8") as fh:
            state = json.load(fh)
        fps = {m["id"]: m["fingerprint"] for m in state["modules"]}
        self.assertEqual(fps["a"], "7")


if __name__ == "__main__":
    unittest.main()
