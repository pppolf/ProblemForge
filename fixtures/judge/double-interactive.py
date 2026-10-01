import os
import sys
# The hidden input and answer exist only in the interactor's separate sandbox.
assert not os.path.exists('/w/hidden-input')
assert not os.path.exists('/w/jury-answer')
assert not os.path.exists('/w/interaction-output')
print('hidden files absent', file=sys.stderr)
n=int(input())
print(2*n, flush=True)
