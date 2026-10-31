# Conquerors tests

`engine.test.mjs` checks the game logic in `conquerors/js/` with plain Node (no dependencies):
polyline encode/decode against Google's reference example, tile coordinates against a known
Berlin tile, largest-square detection, and a full computation over the demo city.

```sh
cd tools/conquerors-tests && node engine.test.mjs
```

It ends with `ALL OK`; any failed assertion throws.
