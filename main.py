"""入口：python main.py [项目.json]，缺省载入示例项目。"""
import os
import sys

from aligner.app import AlignerApp

if __name__ == "__main__":
    path = sys.argv[1] if len(sys.argv) > 1 else os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "sample_project.json")
    app = AlignerApp(path)
    app.mainloop()
