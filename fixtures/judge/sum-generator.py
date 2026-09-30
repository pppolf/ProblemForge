import os
import random
import sys
seed = sys.argv[-1]
assert os.environ['PF_SEED'] == seed
rng = random.Random(seed)
maximum = int(sys.argv[1]) if len(sys.argv) > 2 else 100
print(rng.randint(1, maximum), rng.randint(1, maximum))
