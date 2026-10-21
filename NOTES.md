# Phase 0 Recon: Blockbench Architecture & Source Notes

All findings below were investigated and verified directly from the [Blockbench GitHub repository](https://github.com/JannisX11/blockbench).

---

## 1. How does `updateGeometry` order vertices, and which faces does it skip?

### Source Reference
- **File**: [`js/outliner/types/mesh.js`](https://github.com/JannisX11/blockbench/blob/master/js/outliner/types/mesh.js)
- **Class / Location**: `NodePreviewController(Mesh, { ... })` -> `updateGeometry(element, vertex_offsets)` (Lines 1230–1309, 1415–1419)

### Code Snippets
```javascript
// js/outliner/types/mesh.js (lines 1248-1254)
function addVertexPosition(vkey, normal) {
    let vertex = vertices[vkey];
    position_array.push(vertex[0], vertex[1], vertex[2]);
    normal_array.push(normal[0], normal[1], normal[2]);
    let color = weight_color_generator?.getVertexColor(vkey) ?? PLAIN_VERTEX_COLOR;
    color_array.push(color[0], color[1], color[2]);
}
```

```javascript
// js/outliner/types/mesh.js (lines 1271-1309)
for (let key in faces) {
    let face = faces[key];
    if (face.vertices.length <= 2) continue; // SKIPS faces with <= 2 vertices

    let normal;
    if (element.shading == 'flat') {
        normal = face.getNormal(true);
    }

    if (face.vertices.length == 3) {
        // Tri: vertices added in face.vertices order
        face.vertices.forEach((vkey, i) => {
            indices.push(position_array.length / 3);
            addVertexPosition(vkey, element.shading == 'smooth' ? vertex_normals[vkey] : normal);
        })

    } else if (face.vertices.length == 4) {
        // Quad: vertex buffer pushed in face.vertices order
        let index_offset = position_array.length / 3;
        let sorted_vertices = Modes.animate ? face.vertices : face.getSortedVertices();
        cached_face_vertices[key] = sorted_vertices;
        let face_indices = {};
        face.vertices.forEach((vkey, i) => {
            if (!vertices[vkey]) {
                throw new Error(`Face "${key}" in mesh "${element.name}" contains an invalid vertex key "${vkey}"`, face)
            }
            addVertexPosition(vkey, element.shading == 'smooth' ? vertex_normals[vkey] : normal);
            face_indices[vkey] = index_offset + i;
        })

        indices.push(face_indices[sorted_vertices[0]]);
        indices.push(face_indices[sorted_vertices[1]]);
        indices.push(face_indices[sorted_vertices[2]]);
        indices.push(face_indices[sorted_vertices[0]]);
        indices.push(face_indices[sorted_vertices[2]]);
        indices.push(face_indices[sorted_vertices[3]]);
    }
}
```

```javascript
// js/outliner/types/mesh.js (lines 1415-1418)
mesh.geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(position_array), 3));
mesh.geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(normal_array), 3));
mesh.geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(color_array), 3));
mesh.geometry.setIndex(indices);
```

### Findings
1. **Faces skipped**:
   - Faces where `face.vertices.length <= 2` are explicitly skipped with `if (face.vertices.length <= 2) continue;`.
   - Faces with `length > 4` are ignored (only `== 3` and `== 4` branches exist).
2. **Vertex ordering**:
   - For **both** triangles (`length == 3`) and quads (`length == 4`), vertices are pushed to `position_array` and `color_array` in the **order of `face.vertices`** (`face.vertices.forEach(...)`).
   - For quads, `sorted_vertices` determines only index winding order (`indices.push(...)`), **not** buffer insertion order.
3. **Color attribute**:
   - Blockbench already writes a 3-float `color` attribute to `mesh.geometry` via `addVertexPosition`. When weight paint mode is inactive, it populates it with `PLAIN_VERTEX_COLOR` (`[0, 0.03, 0.08]` — line 1111).

---

## 2. How is the textured material built (ShaderMaterial?), and what is the most robust way to patch it?

### Source Reference
- **Files**:
  - [`js/texturing/textures.js`](https://github.com/JannisX11/blockbench/blob/master/js/texturing/textures.js) (Lines 77–95, 883–892)
  - [`js/preview/canvas.js`](https://github.com/JannisX11/blockbench/blob/master/js/preview/canvas.js) (Lines 167–176)
  - [`js/shaders/texture.vert.glsl`](https://github.com/JannisX11/blockbench/blob/master/js/shaders/texture.vert.glsl)
  - [`js/shaders/texture.frag.glsl`](https://github.com/JannisX11/blockbench/blob/master/js/shaders/texture.frag.glsl)
  - [`js/outliner/types/mesh.js`](https://github.com/JannisX11/blockbench/blob/master/js/outliner/types/mesh.js) (Lines 1442–1500)

### Code Snippets
```javascript
// js/texturing/textures.js (lines 77-94)
let mat = new THREE.ShaderMaterial({
    uniforms: {
        map: {type: 't', value: tex},
        SHADE: {type: 'bool', value: settings.shading.value},
        LIGHTCOLOR: {type: 'vec3', value: new THREE.Color().copy(Canvas.global_light_color).multiplyScalar(settings.brightness.value / 50)},
        LIGHTSIDE: {type: 'int', value: Canvas.global_light_side},
        EMISSIVE: {type: 'bool', value: this.render_mode == 'emissive'}
    },
    vertexShader: prepareShader(VertShader),
    fragmentShader: prepareShader(FragShader),
    blending: this.render_mode == 'additive' ? THREE.AdditiveBlending : THREE.NormalBlending,
    side: Canvas.getRenderSide(this),
    transparent: true,
    clipping: true
});
mat.map = tex;
mat.name = this.name;
this.material = mat;
```

```glsl
// js/shaders/texture.vert.glsl (excerpts)
attribute float highlight;
#include <common>
#include <clipping_planes_pars_vertex>

uniform bool SHADE;
uniform int LIGHTSIDE;

centroid varying vec2 vUv;
varying float light;
varying float lift;
```

```glsl
// js/shaders/texture.frag.glsl (lines 20-27)
if (EMISSIVE == false) {
    vec4 lit_color = vec4(lift + color.rgb * light, color.a);
    gl_FragColor = lit_color;
    gl_FragColor.r = gl_FragColor.r * LIGHTCOLOR.r;
    gl_FragColor.g = gl_FragColor.g * LIGHTCOLOR.g;
    gl_FragColor.b = gl_FragColor.b * LIGHTCOLOR.b;
}
```

```javascript
// js/preview/canvas.js (lines 168-176) - Canvas.emptyMaterials for untextured faces:
Canvas.emptyMaterials[i] = new THREE.ShaderMaterial({
    uniforms: {
        map: {type: 't', value: tex},
        ...commonUniforms
    },
    vertexShader: prepareShader(MarkerVertShader),
    fragmentShader: prepareShader(MarkerFragShader),
    side: THREE.DoubleSide,
})
```

### Findings & Most Robust Patch Strategy
1. **Material Architecture**:
   - All textured materials are custom `THREE.ShaderMaterial` instances.
   - They use `VertShader` (`texture.vert.glsl`) and `FragShader` (`texture.frag.glsl`).
   - Three.js version is `^0.129.0`.
2. **Why BBColor's approach failed**:
   - BBColor patched Three.js compiler hooks or wrapped `ShaderMaterial` and set `modparameters` as a global variable only conditionally, causing pollution and undefined parameter errors on non-matching materials.
3. **Most Robust Patching Method**:
   - Use a private attribute name (`vp_color`) and varying (`vVpColor`) instead of the standard `color` attribute to prevent collision with Blockbench's weight paint system (which constantly resets `geometry.attributes.color` to `[0, 0.03, 0.08]`).
   - Use tolerant regexes for shader injection:
     - `UV_DECL = /(?:centroid\s+)?varying\s+vec2\s+vUv\s*;/`
     - `UV_ASSIGN = /\bvUv\s*=\s*uv\s*;/`
     - `SAMPLE = /vec4\s+(\w+)\s*=\s*texture(?:2D)?\s*\(\s*map\s*,\s*vUv\s*\)\s*;/`
   - **Vertex Shader**: Inject `attribute vec3 vp_color; varying vec3 vVpColor;` and `vVpColor = vp_color;`.
   - **Fragment Shader**: Inject `varying vec3 vVpColor;` and multiply the sampled texture color (`color.rgb *= vVpColor;`).
   - Set `material.defaultAttributeValues = { ...defaultAttributeValues, vp_color: [1.0, 1.0, 1.0] }` so any geometries without vertex colors (cubes, gizmos) cleanly default to un-tinted white.
   - Patch existing textures in `Texture.all`, `Canvas.emptyMaterials`, and ensure meshes in `_writeVertexColorsToGeometry` have their materials patched directly.
   - Revert shaders and remove `vp_color` attribute in `onunload()`.

---

## 3. How does the glTF codec build its scene? Does it clone live geometry, and is there a hook?

### Source Reference
- **Files**:
  - [`js/formats/standards/gltf.js`](https://github.com/JannisX11/blockbench/blob/master/js/formats/standards/gltf.js) (Lines 523–604)
  - [`js/lib/GLTFExporter.js`](https://github.com/JannisX11/blockbench/blob/master/js/lib/GLTFExporter.js) (Lines 119, 1244, 1273)

### Code Snippets
```javascript
// js/formats/standards/gltf.js (lines 538-545)
Outliner.root.forEach(node => {
    if (node instanceof Group && options.armature) {
        let skinned_mesh = buildSkinnedMeshFromGroup(node, options.scale);
        gl_scene.children.push(skinned_mesh);
    } else if (!node.scene_object.no_export) {
        gl_scene.children.push(node.mesh); // DIRECT LIVE MESH ADDED, NO CLONE!
    }
})
```

```javascript
// js/formats/standards/gltf.js (lines 573-585)
let result = await new Promise((resolve, reject) => {
    exporter.parse(gl_scene, resolve, {
        animations,
        onlyVisible: false,
        trs: true,
        binary: options.encoding == 'binary',
        truncateDrawRange: false,
        forcePowerOfTwoTextures: options.embed_textures != false,
        scale_factor: 1/options.scale,
        embedImages: options.embed_textures != false,
        exportFaceColors: false, // EXPLICITLY HARDCODED TO FALSE
    });
})
```

```javascript
// js/lib/GLTFExporter.js (lines 1244, 1273)
color: 'COLOR_0',
...
if (!options.exportFaceColors && attributeName === 'COLOR_0' ) continue;
```

### Findings
1. **Live vs. Cloned Geometry**:
   - For standard mesh nodes (`node.mesh`), `compile()` pushes the **live** mesh (`node.mesh`) directly into `gl_scene.children`. Geometry is **not cloned**.
   - (For armatures / skinned meshes, `mesh_obj.mesh.geometry.clone()` is used, or a merged geometry is constructed).
2. **`exportFaceColors: false`**:
   - Blockbench explicitly specifies `exportFaceColors: false` when calling `exporter.parse()`.
   - In `GLTFExporter.js`, if `options.exportFaceColors` is false, it explicitly ignores `COLOR_0`.
3. **Synchronous Execution**:
   - Although `exporter.parse(gl_scene, resolve, options)` accepts a callback, `processNode()` and `processMesh()` run **synchronously** inside the initial `parse()` call.
4. **Hook Architecture**:
   - There is no native hook in `gltf.js` to modify exporter options directly.
   - The verified mechanism is:
     1. Wrap `Codecs.gltf.compile` in a try/finally to set an `exportingVC = true` flag.
     2. Wrap `THREE.GLTFExporter.prototype.parse`. When `exportingVC` is active, traverse `gl_scene`, inspect each geometry, stash any existing `color` attribute, attach our vertex colors attribute as `color` (converted sRGB -> linear), delete `vp_color` so it does not export as custom `_VP_COLOR`, and pass `options.exportFaceColors = true`.
     3. Restore original attributes in a `finally` block immediately after calling the original `parse`.

---

## 4. Does a `Property` on `MeshFace` go into undo, save, and duplicate? Is an object type available?

### Source Reference
- **Files**:
  - [`js/util/property.ts`](https://github.com/JannisX11/blockbench/blob/master/js/util/property.ts) (Lines 30–45, 96–190)
  - [`js/outliner/abstract/face.ts`](https://github.com/JannisX11/blockbench/blob/master/js/outliner/abstract/face.ts) (Lines 18–87)
  - [`js/outliner/types/mesh.js`](https://github.com/JannisX11/blockbench/blob/master/js/outliner/types/mesh.js) (Lines 18–42, 609, 635)

### Code Snippets
```typescript
// js/util/property.ts (lines 33-45, 114)
interface IPropertyType {
    string: string
    enum: string
    molang: string
    number: number
    boolean: boolean
    array: any[]
    object: any  // <-- OBJECT TYPE AVAILABLE
    instance: any
    vector: ArrayVector3
    vector2: ArrayVector2
    vector4: ArrayVector2
}
```

```typescript
// js/util/property.ts (lines 124-129, 151-155, 169-173)
getDefault(instance) {
    ...
    else if (this.isObject) {
        return Object.keys(this.default).length ? structuredClone(this.default) : {} as any;
    }
}
merge(instance, data) {
    ...
    else if (this.isObject) {
        if (typeof data[this.name] == 'object') {
            instance[this.name] = structuredClone(data[this.name]);
        }
    }
}
copy(instance, target) {
    ...
    else if (this.isObject) {
        if (typeof instance[this.name] == 'object') {
            target[this.name] = structuredClone(instance[this.name]);
        }
    }
}
```

```typescript
// js/outliner/abstract/face.ts (lines 20-35, 60-75, 79-86)
constructor(data: FaceOptions) {
    for (let key in (this.constructor as typeof Face).properties) {
        (this.constructor as typeof Face).properties[key].reset(this);
    }
}
extend(data: FaceOptions): this {
    for (let key in (this.constructor as typeof Face).properties) {
        (this.constructor as typeof Face).properties[key].merge(this, data)
    }
    ...
}
getSaveCopy() {
    let copy = { uv: this.uv, texture: undefined }
    for (let key in (this.constructor as typeof Face).properties) {
        if (this[key] != (this.constructor as typeof Face).properties[key].default) {
            (this.constructor as typeof Face).properties[key].copy(this, copy);
        }
    }
    ...
    return copy;
}
getUndoCopy(): Face {
    let copy = new (this.constructor as any)(this.direction, this) as Face & {cube?: any, mesh?: any};
    delete copy.cube;
    delete copy.mesh;
    delete copy.direction;
    return copy;
}
```

### Findings
1. **Object Type Availability**:
   - `Property` fully supports `type: 'object'`.
   - Its default value is `{}`.
   - Its `getDefault()`, `merge()`, and `copy()` automatically use `structuredClone()`, guaranteeing deep-cloned instances and avoiding shared references.
2. **Undo, Save, and Duplicate**:
   - **Save**: `Mesh.prototype.getSaveCopy` calls `face.getSaveCopy()`. `Face.prototype.getSaveCopy` iterates over `Face.properties` and invokes `property.copy(this, copy)`.
   - **Undo**: `Mesh.prototype.getUndoCopy` calls `face.getUndoCopy()`, which creates an instance with `new (this.constructor)(this.direction, this)`. When undo restores, it calls `MeshFace.extend(undoData)`, which runs `property.merge(this, data)`.
   - **Duplicate**: Duplication runs through element copy / init, deserializing face data through `new MeshFace(this, faceData)` and `face.extend(faceData)`.
   - Therefore, a `Property(MeshFace, 'object', 'vertex_colors')` is **fully covered** across undo, save (`.bbmodel`), and duplicate.

---

## 5. What are the real ranges of the brush sliders, and what is the color panel’s getter?

### Source Reference
- **Files**:
  - [`js/texturing/painter.js`](https://github.com/JannisX11/blockbench/blob/master/js/texturing/painter.js) (Lines 491, 597, 3752–3821)
  - [`js/texturing/color.js`](https://github.com/JannisX11/blockbench/blob/master/js/texturing/color.js) (Lines 65–105)

### Code Snippets
```javascript
// js/texturing/painter.js (lines 3752-3758) - Size Slider
new NumSlider('slider_brush_size', {
    condition: () => (Toolbox && ((Toolbox.selected.brush?.size == true) || ['draw_shape_tool'].includes(Toolbox.selected.id))),
    tool_setting: 'brush_size',
    category: 'paint',
    settings: {
        min: 1, max: 1024, interval: 1, default: 1,
    },
    ...
})
```

```javascript
// js/texturing/painter.js (lines 3770-3776) - Softness Slider
new NumSlider('slider_brush_softness', {
    category: 'paint',
    condition: () => (Toolbox && (Toolbox.selected.brush?.softness == true)),
    tool_setting: 'brush_softness',
    settings: {
        min: 0, max: 100, default: 0,
        gesture_speed: 2,
        show_bar: true,
        ...
    }
})
```

```javascript
// js/texturing/painter.js (lines 3791-3800) - Opacity Slider
new NumSlider('slider_brush_opacity', {
    category: 'paint',
    condition: () => (Toolbox && ((Toolbox.selected.brush?.opacity == true) || ...)),
    tool_setting: 'brush_opacity',
    settings: {
        min: 0,
        get max() {return settings.opacity_range.value == '255' ? 255 : 100},
        get default() {return settings.opacity_range.value == '255' ? 255 : 100},
        get gesture_speed() {return settings.opacity_range.value == '255' ? 4 : 1},
        show_bar: true,
        ...
    }
})
```

```javascript
// js/texturing/color.js (lines 101-105) - ColorPanel Getter
export const ColorPanel = {
    ...
    get(secondary) {
        let color = secondary ? ColorPanel.panel.vue.second_color : ColorPanel.panel.vue.main_color;
        ColorPanel.addToHistory(color);
        return color;
    },
    ...
}
```

```javascript
// js/texturing/painter.js (lines 491, 597)
let color = tinycolor(ColorPanel.get()).toRgb();
```

### Findings
1. **Brush Sliders**:
   - **Size** (`BarItems.slider_brush_size`): `min: 1`, `max: 1024`, `default: 1`.
   - **Softness** (`BarItems.slider_brush_softness`): `min: 0`, `max: 100`, `default: 0`.
   - **Opacity** (`BarItems.slider_brush_opacity`): `min: 0`, `max: settings.opacity_range.value == '255' ? 255 : 100`.
   - **Bug identified**: Hardcoding `/ 255` breaks when user setting `opacity_range` is set to `'100'`. The correct divisor is `BarItems.slider_brush_opacity.settings.max` (or checking `settings.opacity_range.value`).
2. **Color Panel Getter**:
   - The official getter is `ColorPanel.get(secondary)`:
     - `ColorPanel.get()` returns the primary color as a hex string (e.g. `"#ff0040"`).
     - `ColorPanel.get(true)` returns the secondary color.
   - To get RGB values: `tinycolor(ColorPanel.get()).toRgb()` returns `{ r, g, b, a }` with values in 0–255.

---

## 6. Which mesh operations reorder `face.vertices`, such as flip normals?

### Source Reference
- **Files**:
  - [`js/outliner/types/mesh.js`](https://github.com/JannisX11/blockbench/blob/master/js/outliner/types/mesh.js) (Lines 40, 197–200, 855, 884)
  - [`js/modeling/mesh_editing.js`](https://github.com/JannisX11/blockbench/blob/master/js/modeling/mesh_editing.js) (Lines 668, 983, 1157, 1388)

### Code Snippets
```javascript
// js/outliner/types/mesh.js (lines 197-200)
invert() {
    if (this.vertices.length < 3) return this;
    [this.vertices[0], this.vertices[1]] = [this.vertices[1], this.vertices[0]];
}
```

```javascript
// js/outliner/types/mesh.js (lines 38-42) - getSaveCopy
getSaveCopy(nested) {
    let copy = super.getSaveCopy(nested);
    copy.vertices = this.getSortedVertices(); // SORTS VERTICES ON SAVE
    return copy;
}
```

```javascript
// js/outliner/types/mesh.js (line 855) - Mesh.prototype.flip
for (let key in this.faces) {
    this.faces[key].invert();
}
```

```javascript
// js/outliner/types/mesh.js (line 884) - Mesh.prototype.mirror
if (object_mode || face.isSelected(key) || face.vertices.allAre(vkey => selected_vertices.includes(vkey))) {
    face.invert();
}
```

```javascript
// js/modeling/mesh_editing.js (line 668) - Action 'invert_face' (Flip Normals)
face.invert();
```

### Findings
1. **Operations that reorder `face.vertices`**:
   - **Flip Normals** (`Action('invert_face')`): calls `face.invert()`, which directly swaps index 0 and 1: `[this.vertices[0], this.vertices[1]] = [this.vertices[1], this.vertices[0]]`.
   - **Mesh Flip Axis** (`Mesh.prototype.flip(axis)`): calls `face.invert()` on every face.
   - **Mesh Mirror Axis** (`Mesh.prototype.mirror(axis)`): calls `face.invert()` on selected / affected faces.
   - **Mesh Save** (`MeshFace.prototype.getSaveCopy`): sets `copy.vertices = this.getSortedVertices()`, changing vertex order on save.
   - **Extrude, Bridge, and Knife Tools**: invoke `face.invert()` or construct new faces from sorted vertices.
2. **Impact on Data Architecture**:
   - If vertex colors are stored in an array indexed by position (`[c0, c1, c2, c3]`), any flip, mirror, normal inversion, or save sort will instantly scramble color assignments across the polygon.
   - By keying colors by vertex key:
     ```javascript
     face.vertex_colors = {
         "v_abc123": [r, g, b],
         "v_def456": [r, g, b]
     }
     ```
     the colors remain permanently linked to the geometric vertex regardless of swaps or reordering of `face.vertices`. This matches Blockbench's native UV architecture (`face.uv[vkey] = [u, v]`).

---

## 7. Phase 3 Recon: Occlusion, Raycasting, Camera Invalidation, & Stroke Undo

### Source Reference
- **Files**:
  - [`js/modeling/weight_paint.ts`](https://github.com/JannisX11/blockbench/blob/master/js/modeling/weight_paint.ts) (Lines 37–69, 191–200, 249–253)
  - [`js/texturing/painter.js`](https://github.com/JannisX11/blockbench/blob/master/js/texturing/painter.js) (Lines 1145–1175, 3791–3800)

### Code Snippets
```typescript
// js/modeling/weight_paint.ts (lines 38-69) - Raycaster Occlusion & Camera Invalidation
let screen_space_vertex_positions: null | Record<string, {x:number, y:number}> = null;
const raycaster = new THREE.Raycaster();
function updateScreenSpaceVertexPositions(mesh: Mesh) {
    if (screen_space_vertex_positions) return screen_space_vertex_positions;

    const depth_check = BarItems.weight_brush_xray.value == false;
    let vec = new THREE.Vector3();
    raycaster.ray.origin.setFromMatrixPosition(Preview.selected.camera.matrixWorld);

    screen_space_vertex_positions = {};
    for (let vkey in mesh.vertices) {
        let pos = mesh.mesh.localToWorld(vec.fromArray(mesh.vertices[vkey]));
        if (depth_check) {
            raycaster.ray.direction.copy(pos).sub(raycaster.ray.origin);
            const z_distance = raycaster.ray.direction.length();
            raycaster.ray.direction.normalize();
            let intersection = raycaster.intersectObject(mesh.mesh, false)[0];
            if (intersection && intersection.distance < z_distance - 0.001) {
                continue; // Occluded by geometry in front!
            }
        }
        let screen_pos = Preview.selected.vectorToScreenPosition(pos.clone());
        screen_space_vertex_positions[vkey] = screen_pos;
    }
    return screen_space_vertex_positions;
}
Blockbench.on('update_camera_position', () => {
    screen_space_vertex_positions = null;
})
```

```typescript
// js/modeling/weight_paint.ts (lines 191-199) - Single Undo Step per Stroke
const stop = (event: MouseEvent) => {
    document.removeEventListener('pointermove', draw);
    document.removeEventListener('pointerup', stop);

    Undo.finishEdit('Paint vertex weights');
}
document.addEventListener('pointermove', draw);
document.addEventListener('pointerup', stop);
draw(data.event as MouseEvent, data);
```

```typescript
// js/modeling/weight_paint.ts (lines 249-253) - X-Ray / Ignore Depth Toggle
new Toggle('weight_brush_xray', {
    icon: 'disabled_visible',
    category: 'edit',
    condition: () => Toolbox?.selected?.id == 'weight_brush',
})
```

### Findings
1. **Raycaster Occlusion**:
   - `raycaster.ray.origin.setFromMatrixPosition(preview.camera.matrixWorld)`.
   - `raycaster.ray.direction.copy(pos).sub(raycaster.ray.origin)`.
   - `intersection.distance < z_distance - 0.001` (or `- 0.005`) determines if a surface in front blocks the vertex.
2. **Culling Order**:
   - In Blockbench's `weight_paint.ts`, raycasting every vertex upfront causes performance issues on large meshes.
   - For vertex paint, we first cull by 2D screen distance (`distPx <= brushSizePx`). Only vertices inside the brush radius are tested against the raycaster, and results are cached per vertex key in `occlusionCache`.
3. **Camera Invalidation**:
   - `Blockbench.on('update_camera_position', () => { ... })` invalidates the screen space vertex cache and occlusion cache whenever the camera is orbited, panned, or zoomed.
4. **Single Undo Step**:
   - `Undo.initEdit` is called once on pointerdown, `draw` mutates vertex colors on pointermove, and `Undo.finishEdit` is called once on pointerup.
5. **Continuous Stroke Interpolation**:
   - Fast pointer movement is interpolated continuously using swept circle / distance-to-segment math from `lastPos` to `currentPos`, ensuring smooth uninterrupted strokes without skipping vertices.

