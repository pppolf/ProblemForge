# Trusted supervisor, run inside the Interactor's restricted Linux environment.
# fd 3 is private control to the relay and is closed in the author child.
import json
import os
import subprocess
import sys

result = subprocess.run(sys.argv[1:], close_fds=True)
os.write(3, (json.dumps({'kind': 'INTERACTOR_EXIT', 'exitCode': result.returncode})+'\n').encode())
sys.exit(result.returncode if result.returncode >= 0 else 128-result.returncode)
