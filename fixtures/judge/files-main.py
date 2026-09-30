from pathlib import Path

a, b = map(int, Path('input.txt').read_bytes().split())
Path('output.txt').write_bytes(f'{a + b}\n'.encode())
