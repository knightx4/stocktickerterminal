#!/bin/sh
# Builds the sample bundle and runs the parser test on this computer (needs g++ and python3).
set -e
cd "$(dirname "$0")"
OUT=$(mktemp -d)
python3 make_sample_bundle.py "$OUT/sample.bin"
g++ -std=c++17 -fsanitize=address,undefined -g -Ihoststub -I../src host_test.cpp ../src/bundle.cpp -o "$OUT/host_test"
"$OUT/host_test" "$OUT/sample.bin"
rm -rf "$OUT"
