Never use a Blockbench API from memory. Find it in the Blockbench GitHub source first and record the file and snippet in NOTES.md.
Do one phase at a time, then stop and wait for the human to report the test result.
Keep everything in vertex_paint.js, and treat BBColor as an idea reference only.
If an API can’t be found, stop and ask. Don’t invent one.

---

Phase 0, recon with no code changes. Answer these from source:

- How does updateGeometry order vertices, and which faces does it skip?
- How is the textured material built (ShaderMaterial?), and what is the most robust way to patch it?
- How does the glTF codec build its scene? Does it clone live geometry, and is there a hook?
- Does a Property on MeshFace go into undo, save and duplicate? Is an object type available?
- What are the real ranges of the brush sliders, and what is the color panel’s getter?
- Which mesh operations reorder face.vertices, such as flip normals?

Phase 1, data model. Store a per-face vertex_colors object keyed by vertex key, not by index, so flips can’t scramble it. Default to white, with no shared array references between faces. Delete the cube support and the custom vertex dots. Test: paint, save, reload, undo, redo, duplicate and flip a face.

Phase 2, rendering. Wrap updateGeometry to write a 3-float color attribute in the same order and with the same skip rule as the builder. Patch the textured shader to multiply texture by color, with an assertion that the string replacement actually matched. Make the display toggle a flag, not a material swap. Test: textures stay visible, and colors survive vertex edits.

Phase 3, painting. Cull vertices by screen radius first, then do a cached raycast occlusion check (invalidate on camera move), plus an “ignore depth” toggle. Interpolate between pointer events. Read the opacity slider’s real maximum. Make each stroke one undo step. Keep the native sliders and palette, since that’s your streamlined part.

Phase 4, Wrap Codecs.gltf.compile in try/finally to set an exportingVC flag.
Wrap THREE.GLTFExporter.prototype.parse. When the flag is set:
Traverse the scene.
For each geometry, stash any existing color attribute and delete it, so stale weight-paint colors can’t leak out.
If the geometry has non-white vp_color of matching length, swap in a color attribute with values converted sRGB→linear, and remove vp_color so it isn’t exported as a custom _VP_COLOR.
Call the original parse with exportFaceColors: true.
Restore everything in finally. The restore is safe right after the call, because the exporter processes meshes synchronously inside parse.
If a geometry’s attribute length doesn’t match its position count (the merged armature path), skip it and console.warn.
Remove the wrappers in onunload.

Phase 5, cleanup. Unload should remove listeners and restore the original updateGeometry (BBColor admits it doesn’t). New faces from extrude or subdivide stay white for now, and that goes in a known-limits note.