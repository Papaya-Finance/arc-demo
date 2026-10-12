"""Hold an advisory lock across exec on macOS/Linux; the OS releases it on exit."""
import fcntl
import os
import sys
from pathlib import Path

state = Path(os.environ["STATE_FILE"])
state.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
fd = os.open(str(state) + ".lock", os.O_CREAT | os.O_RDWR, 0o600)
try:
    fcntl.flock(fd, fcntl.LOCK_EX | fcntl.LOCK_NB)
except BlockingIOError:
    sys.exit("Another local keeper holds this checkpoint lock")
os.set_inheritable(fd, True)
os.execvpe(sys.argv[1], sys.argv[1:], os.environ)
