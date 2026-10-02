#!/bin/sh
set -eu
# This fixed entry point runs inside go-judge, never in the Worker or host.
# Only a bounded heap size and a fixed warning switch come from the profile.
case "$1" in ''|*[!0-9]*) exit 2 ;; esac
if [ "$1" -lt 32 ] || [ "$1" -gt 1024 ]; then exit 2; fi
case "$2" in all|none) ;; *) exit 2 ;; esac
export JAVA_TOOL_OPTIONS="-Xms16m -Xmx${1}m -Xss1m -XX:+UseSerialGC -XX:ActiveProcessorCount=1 -XX:ReservedCodeCacheSize=32m -XX:-UsePerfData"
mkdir classes
/usr/bin/javac --release 17 -encoding UTF-8 -proc:none "-Xlint:$2" -d classes Main.java
# Keep every class, including nested/anonymous classes, in the cached artifact.
exec /usr/bin/jar --create --file program.jar --main-class Main -C classes .
