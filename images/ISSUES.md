Textures vanish while painting. You swap in a flat Lambert material. BBColor instead patches Blockbench’s textured shader so texture × vertex color. That’s the idea to port, but not the code: it assigns modparameters as a global only inside the if, so any non-matching ShaderMaterial gets stale or undefined params.
Colors live in an unregistered part.vertexColors. They aren’t saved to .bbmodel, aren’t covered by undo, and are lost on duplicate. BBColor registers a Property on MeshFace.
Reattachment fires on the wrong events. Blockbench rebuilds the geometry whenever a mesh changes, which discards your attribute. You re-apply on update_view and update_selection, which fire constantly. BBColor wraps Mesh.preview_controller.updateGeometry, which is the right place.
The buffer mapping is off. It doesn’t skip faces with 2 or fewer vertices the way the geometry builder does, so colors misalign. Cubes can’t work at all because their buffers have 24 vertices, not 8. Since you don’t box model, scope it to meshes only.
Standard naming is your advantage. Your plugin uses three.js’s standard color attribute, which three’s GLTFExporter writes as COLOR_0. BBColor’s custom vColor would be ignored, which is probably why it stops at FBX. Whether it flows through depends on how Blockbench’s glTF codec builds its scene, so that needs checking first.
Smaller issues: painting goes through to back faces, fast drags skip vertices, and dividing opacity by 255 may be stale after the 100/255 setting. Colors also need a decision on color space, since hex is sRGB and glTF vertex colors are linear.

---

This is a sketch to verify, not tested code. The sRGB→linear conversion is there because glTF vertex colors are linear and your hex values are sRGB.

What’s still open

Phase 0 items (b), (d), (e), (f) need js/outliner/types/mesh.js, where updateGeometry and the weight-paint code live, plus wherever the textured ShaderMaterial is built.