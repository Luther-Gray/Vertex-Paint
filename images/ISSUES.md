Brush sensitivity (cleanup)

The cause is that every pointermove re-applies the brush to the already-painted color, and the click itself draws once before the first move. The fix is to remember each vertex’s original color for the duration of the stroke and cap the strength at the strongest dab:

js
const strokeState = new Map(); // per stroke
// in the per-face apply:
const k = fkey + "|" + v.vkey;
let st = strokeState.get(k);
if (!st) strokeState.set(k, st = { orig: _getFaceVertexColor(face, v.vkey).slice(), s: 0 });
st.s = Math.max(st.s, alpha);
_setFaceVertexColor(face, v.vkey, [0,1,2].map(i => st.orig[i] + (targetRGB[i] - st.orig[i]) * st.s));

A 15% brush then gives at most 15% per stroke. Add a “Buildup” toggle for the airbrush feel: when it’s on, skip the cap and only dab once the cursor has moved at least max(3, radius * 0.25) px from the last dab. That also kills the click-plus-jitter doubling.

Pixel grid and settings reset

I can’t see these from the code alone, so Gemini should check:

Pixel grid: your earlier version hid Canvas.brush_outline, and this one doesn’t. Have Gemini search Blockbench for brush_outline and hide it on select, plus on each pointermove if Blockbench re-shows it.
Outline looks like 1: the circle only gets its size inside pointermove, so after switching back it’s stale until the mouse moves. BBColor calls .update() on its sliders in onSelect, so do the same for slider_brush_size, softness and opacity. Store the last pointer position and redraw the outline immediately.
Hover marker: re-add it to Canvas.scene on select in case the scene was rebuilt.

The slider numbers

The values are fine and the displays are stale. Your onSelect only shows the outline, and nothing refreshes the sliders. BBColor’s code calls .update() on its sliders in onSelect, which is the likely fix. Blockbench probably re-shows the sliders after onSelect runs, so the refresh may need to be deferred a tick.

Cleanup list to paste to Gemini

In onSelect for the paint tool, call BarItems.slider_brush_size.update(), then the same for slider_brush_softness and slider_brush_opacity. If the numbers still show 1, wrap the calls in setTimeout(..., 0). If that still fails, find how Blockbench’s native brush tool refreshes these sliders on switch and copy it.
Store the last pointer position, and redraw the brush outline in onSelect using it, so it doesn’t wait for a mouse move.
Hide the pixel grid square. Search Blockbench for Canvas.brush_outline and hide it on select, and again on pointermove if it gets re-shown. Restore it in onUnselect.
Re-add the hover marker to Canvas.scene on select.
Apply the per-stroke strength cap, with the buildup toggle and minimum-distance spacing I described.
Remove the eraser tool and keep the Ctrl behavior.