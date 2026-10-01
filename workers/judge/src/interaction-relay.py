# Platform-owned relay. Executed ONLY as a third restricted Linux sandbox command.
# Author processes remain in separate environments with independent resources.
import base64
import json
import os
import select
import sys
import time

idle_ms, output_max, transcript_max = map(int, sys.argv[1:])
start = last = time.monotonic()
# input fd, output fd, direction; pipeMapping connects both independent authors.
channels = {3: [4, 'CONTESTANT_TO_INTERACTOR'], 5: [6, 'INTERACTOR_TO_CONTESTANT']}
buffers = {4: bytearray(), 6: bytearray()}
counts = {3: 0, 5: 0}
readers = set(channels) | {7}
control_buffer = bytearray()
writers = {4, 6}
closing = set()
captured = seq = 0
truncated = False
record = open('/w/transcript.jsonl', 'w', buffering=1, encoding='utf-8')
for fd in (3, 4, 5, 6, 7):
    os.set_blocking(fd, False)

def log(kind, direction=None, data=None, exit_code=None):
    global seq
    seq += 1
    event = {'seq': seq, 'elapsedMs': round((time.monotonic()-start)*1000, 3), 'kind': kind}
    if direction:
        event['direction'] = direction
    if exit_code is not None:
        event['exitCode'] = exit_code
    if data is not None:
        event['base64'] = base64.b64encode(data).decode('ascii')
    record.write(json.dumps(event, separators=(',', ':'))+'\n')

def control(kind, direction=None):
    print(json.dumps({'kind': kind, 'direction': direction}), flush=True)

while readers or any(buffers.values()):
    for w in list(closing):
        if not buffers[w] and w in writers:
            os.close(w)
            writers.remove(w)
            closing.remove(w)
    remaining = idle_ms/1000 - (time.monotonic()-last)
    if remaining <= 0:
        log('IDLE')
        control('IDLE')
        break
    ready_r, ready_w, _ = select.select([r for r in readers if r == 7 or len(buffers[channels[r][0]]) < 65536], [w for w in writers if buffers[w]], [], min(remaining, 0.05))
    for r in ready_r:
        chunk = os.read(r, 4096)
        if r == 7:
            if not chunk:
                readers.remove(r)
                os.close(r)
            else:
                control_buffer.extend(chunk)
                if len(control_buffer) > 1024:
                    raise RuntimeError('invalid supervisor control')
                if b'\n' in control_buffer:
                    event = json.loads(control_buffer.split(b'\n')[0])
                    log('INTERACTOR_EXIT', exit_code=event['exitCode'])
                    print(json.dumps(event), flush=True)
                    control_buffer.clear()
            continue
        w, direction = channels[r]
        if not chunk:
            readers.remove(r)
            os.close(r)
            closing.add(w)
            log('EOF', direction)
            control('EOF', direction)
            continue
        last = time.monotonic()
        counts[r] += len(chunk)
        if captured < transcript_max and seq < 2048:
            shown = chunk[:transcript_max-captured]
            log('DATA', direction, shown)
            captured += len(shown)
        else:
            shown = b''
        if len(shown) < len(chunk) and not truncated:
            truncated = True
            log('TRUNCATED', direction)
        if counts[r] > output_max:
            log('OUTPUT_LIMIT', direction)
            control('OUTPUT_LIMIT', direction)
            sys.exit(0)
        if w in writers:
            buffers[w].extend(chunk)
    for w in ready_w:
        try:
            size = os.write(w, buffers[w])
            del buffers[w][:size]
            last = time.monotonic()
        except BrokenPipeError:
            buffers[w].clear()
            writers.remove(w)
            os.close(w)
log('END')
