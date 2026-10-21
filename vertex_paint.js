(function () {
  let pluginInstance = null;
  let onUndoRedoHandler = null;
  let eventListeners = [];
  let hoverMarker = null;
  let brushOutlineEl = null;
  let vertexColorsProperty = null;

  let originalUpdateGeometry = null;

  Plugin.register("vertex_paint", {
    title: "Vertex Paint",
    author: "Luther Gray",
    icon: "fa-circle-nodes",
    description:
      "Vertex painting plugin for Blockbench using native color palettes, brush size, softness falloff, opacity control, bucket fill, eraser, and display toggle.",
    about:
      "# 👁️ Vertex Paint\n" +
      "Vertex Paint brings native 3D vertex painting to Blockbench! It features three dedicated tools and full viewport controls:\n\n" +
      "1. **Vertex Paint Tool**: Paint mesh vertices using standard brush size, softness falloff, and opacity controls.\n" +
      "2. **Vertex Paint Bucket**: Instantly fill selected vertices, faces, or mesh elements using your active palette color and opacity settings.\n" +
      "3. **Vertex Paint Eraser**: Cleanly erase vertex colors back to neutral white with brush size and opacity falloff.\n\n" +
      "Includes a **Toggle Vertex Colors (Eye Icon)** view setting in the View Menu to switch vertex color visibility on/off at any time.",
    version: "1.5.0",
    min_version: "4.8.0",
    variant: "both",

    onload() {
      pluginInstance = this;

      // -------------------------------------------------------------------
      // 1. Data Model: Register Property on MeshFace
      // -------------------------------------------------------------------
      if (typeof Property !== "undefined" && typeof MeshFace !== "undefined") {
        vertexColorsProperty = new Property(MeshFace, "object", "vertex_colors", {
          default: {},
        });
      }

      // -------------------------------------------------------------------
      // 2. Rendering: Hook updateGeometry and Patch Shaders
      // -------------------------------------------------------------------
      _hookUpdateGeometry();
      _patchAllMaterials();

      _setupHoverMarker();

      // -------------------------------------------------------------------
      // 3. Toggle Vertex Colors (Eye Icon View Setting as a Flag)
      // -------------------------------------------------------------------
      this.toggleVertexColors = new Toggle("toggle_vertex_colors", {
        name: "Toggle Vertex Colors",
        description: "Show or hide Vertex Colors in the 3D viewport",
        icon: "fa-eye",
        category: "view",
        default: true,
        onChange: () => {
          _updateAllMeshesGeometry();
        },
      });
      MenuBar.addAction(this.toggleVertexColors, "view");

      // -------------------------------------------------------------------
      // 4. Tool 1: Vertex Paint Tool (Paint Mode Only, Meshes Only)
      // -------------------------------------------------------------------
      this.vertexPaintTool = new Tool("vertex_paint", {
        id: "vertex_paint",
        name: "Vertex Paint Tool",
        icon: "fa-circle-nodes",
        description: "Paint mesh vertices with brush size, falloff, and opacity.",
        category: "tools",
        toolbar: "brush",
        paintTool: false, // Prevents 2D texture pixel grid square box
        cursor: "crosshair",
        selectFace: false,
        transformerMode: "hidden",
        allowed_view_modes: ["textured", "solid", "material", "wireframe"],
        modes: ["edit", "paint"],

        brush: {
          size: true,
          softness: true,
          opacity: true,
        },

        onSelect() {
          _showBrushOutline();
          document.addEventListener("pointermove", _updateHoverState);
        },

        onUnselect: () => {
          _hideHoverMarker();
          _hideBrushOutline();
          document.removeEventListener("pointermove", _updateHoverState);
        },

        onCanvasClick: (data) => {
          _handleBrushStroke(data, false);
        },
      });

      // -------------------------------------------------------------------
      // 5. Tool 2: Vertex Paint Bucket (Meshes Only)
      // -------------------------------------------------------------------
      this.vertexBucketTool = new Tool("vertex_bucket", {
        id: "vertex_bucket",
        name: "Vertex Paint Bucket",
        icon: "fa-fill-drip",
        description: "Color selected mesh vertices, faces, or elements in one click.",
        category: "tools",
        toolbar: "brush",
        paintTool: false,
        cursor: "crosshair",
        selectFace: true,
        transformerMode: "hidden",
        allowed_view_modes: ["textured", "solid", "material", "wireframe"],
        modes: ["edit", "paint"],

        brush: {
          opacity: true,
        },

        onSelect() {
          document.addEventListener("pointermove", _updateHoverState);
        },

        onUnselect: () => {
          _hideHoverMarker();
          document.removeEventListener("pointermove", _updateHoverState);
        },

        onCanvasClick: (data) => {
          _handleBucketFill(data);
        },
      });

      // -------------------------------------------------------------------
      // 6. Tool 3: Vertex Paint Eraser (Meshes Only)
      // -------------------------------------------------------------------
      this.vertexEraserTool = new Tool("vertex_eraser", {
        id: "vertex_eraser",
        name: "Vertex Paint Eraser",
        icon: "fa-eraser",
        description: "Erase mesh vertex colors back to neutral white with brush size and opacity falloff.",
        category: "tools",
        toolbar: "brush",
        paintTool: false,
        cursor: "crosshair",
        selectFace: false,
        transformerMode: "hidden",
        allowed_view_modes: ["textured", "solid", "material", "wireframe"],
        modes: ["edit", "paint"],

        brush: {
          size: true,
          softness: true,
          opacity: true,
        },

        onSelect() {
          _showBrushOutline();
          document.addEventListener("pointermove", _updateHoverState);
        },

        onUnselect: () => {
          _hideHoverMarker();
          _hideBrushOutline();
          document.removeEventListener("pointermove", _updateHoverState);
        },

        onCanvasClick: (data) => {
          _handleBrushStroke(data, true); // Eraser mode = true
        },
      });

      // Add tools to MenuBar under 'tools'
      MenuBar.addAction(this.vertexPaintTool, "tools");
      MenuBar.addAction(this.vertexBucketTool, "tools");
      MenuBar.addAction(this.vertexEraserTool, "tools");

      // -------------------------------------------------------------------
      // 7. Blockbench Event Synchronization
      // -------------------------------------------------------------------
      const registerBBEvent = (name, handler) => {
        Blockbench.on(name, handler);
        eventListeners.push({ name, handler });
      };

      onUndoRedoHandler = () => {
        _updateAllMeshesGeometry();
      };
      registerBBEvent("undo", onUndoRedoHandler);
      registerBBEvent("redo", onUndoRedoHandler);

      registerBBEvent("add_texture", (data) => {
        if (data && data.texture && data.texture.material) {
          _patchMaterial(data.texture.material);
        }
      });

      const recompileHandler = () => {
        if (typeof Project !== "undefined" && Project) {
          _updateAllMeshesGeometry();
        }
      };
      registerBBEvent("change_view_mode", recompileHandler);
      registerBBEvent("select_project", recompileHandler);

      const projectCloseHandler = () => {
        _hideBrushOutline();
        _hideHoverMarker();
      };
      registerBBEvent("unload_project", projectCloseHandler);
      registerBBEvent("close_project", projectCloseHandler);

      // Initial buffer population for open model
      _updateAllMeshesGeometry();
    },

    onunload() {
      eventListeners.forEach(({ name, handler }) => {
        Blockbench.removeListener(name, handler);
      });
      eventListeners = [];
      onUndoRedoHandler = null;

      document.removeEventListener("pointermove", _updateHoverState);
      _removeHoverMarker();
      _hideBrushOutline();

      _unhookUpdateGeometry();
      _unpatchAllMaterials();

      if (vertexColorsProperty) {
        vertexColorsProperty.delete();
        vertexColorsProperty = null;
      }

      if (this.toggleVertexColors) this.toggleVertexColors.delete();
      if (this.vertexPaintTool) this.vertexPaintTool.delete();
      if (this.vertexBucketTool) this.vertexBucketTool.delete();
      if (this.vertexEraserTool) this.vertexEraserTool.delete();

      _cleanupAllMeshesGeometry();
      pluginInstance = null;
    },
  });

  // =======================================================================
  // Rendering Pipeline: updateGeometry Wrapper & Shader Patching
  // =======================================================================

  function _isVertexColorsVisible() {
    if (pluginInstance && pluginInstance.toggleVertexColors) {
      return pluginInstance.toggleVertexColors.value !== false;
    }
    return true;
  }

  const UV_DECL = /(?:centroid\s+)?varying\s+vec2\s+vUv\s*;/;
  const UV_ASSIGN = /\bvUv\s*=\s*uv\s*;/;
  const SAMPLE = /vec4\s+(\w+)\s*=\s*texture(?:2D)?\s*\(\s*map\s*,\s*vUv\s*\)\s*;/;

  function _patchVertexShader(src) {
    if (src.includes("vVpColor")) return src;
    if (!UV_DECL.test(src) || !UV_ASSIGN.test(src)) {
      throw new Error("vertex shader: UV declaration/assignment not found");
    }
    return src
      .replace(UV_DECL, (m) => m + "\nattribute vec3 vp_color;\nvarying vec3 vVpColor;")
      .replace(UV_ASSIGN, (m) => m + "\n\tvVpColor = vp_color;");
  }

  function _patchFragmentShader(src) {
    if (src.includes("vVpColor")) return src;
    const sample = src.match(SAMPLE);
    if (!UV_DECL.test(src) || !sample) {
      throw new Error("fragment shader: UV declaration/texture sample not found");
    }
    return src
      .replace(UV_DECL, (m) => m + "\nvarying vec3 vVpColor;")
      .replace(sample[0], (m) => m + "\n\t" + sample[1] + ".rgb *= vVpColor;");
  }

  function _patchMaterial(material) {
    if (!material || !material.isShaderMaterial || material._vertexColorsPatched) return;
    if (!material.vertexShader || !material.fragmentShader) return;

    try {
      const patchedVert = _patchVertexShader(material.vertexShader);
      const patchedFrag = _patchFragmentShader(material.fragmentShader);

      material._originalVertexShader = material.vertexShader;
      material._originalFragmentShader = material.fragmentShader;

      material.vertexShader = patchedVert;
      material.fragmentShader = patchedFrag;

      // Provide default white for any geometry without vp_color
      material.defaultAttributeValues = Object.assign({}, material.defaultAttributeValues, {
        vp_color: [1.0, 1.0, 1.0],
      });

      material._vertexColorsPatched = true;
      material.needsUpdate = true;
    } catch (err) {
      console.error("Vertex Paint: shader patch failed", err, material.fragmentShader);
    }
  }

  function _unpatchMaterial(material) {
    if (!material || !material._vertexColorsPatched) return;
    if (material._originalVertexShader) material.vertexShader = material._originalVertexShader;
    if (material._originalFragmentShader) material.fragmentShader = material._originalFragmentShader;

    if (material.defaultAttributeValues && material.defaultAttributeValues.vp_color) {
      delete material.defaultAttributeValues.vp_color;
    }

    delete material._originalVertexShader;
    delete material._originalFragmentShader;
    delete material._vertexColorsPatched;
    material.needsUpdate = true;
  }

  function _patchAllMaterials() {
    if (typeof Texture !== "undefined" && Texture.all) {
      Texture.all.forEach((tex) => {
        if (tex && tex.material) _patchMaterial(tex.material);
      });
    }
    if (typeof Canvas !== "undefined" && Canvas.emptyMaterials) {
      Canvas.emptyMaterials.forEach((mat) => {
        if (mat) _patchMaterial(mat);
      });
    }

    // Also patch all existing mesh materials in the project
    const meshes = typeof Mesh !== "undefined" && Mesh.all
      ? Mesh.all
      : (typeof Outliner !== "undefined" && Outliner.elements ? Outliner.elements.filter((el) => el instanceof Mesh) : []);
    meshes.forEach((el) => {
      if (el && el.mesh && el.mesh.material) {
        const mats = Array.isArray(el.mesh.material) ? el.mesh.material : [el.mesh.material];
        mats.forEach((mat) => {
          if (mat) _patchMaterial(mat);
        });
      }
    });
  }

  function _unpatchAllMaterials() {
    if (typeof Texture !== "undefined" && Texture.all) {
      Texture.all.forEach((tex) => {
        if (tex && tex.material) _unpatchMaterial(tex.material);
      });
    }
    if (typeof Canvas !== "undefined" && Canvas.emptyMaterials) {
      Canvas.emptyMaterials.forEach((mat) => {
        if (mat) _unpatchMaterial(mat);
      });
    }

    const meshes = typeof Mesh !== "undefined" && Mesh.all
      ? Mesh.all
      : (typeof Outliner !== "undefined" && Outliner.elements ? Outliner.elements.filter((el) => el instanceof Mesh) : []);
    meshes.forEach((el) => {
      if (el && el.mesh && el.mesh.material) {
        const mats = Array.isArray(el.mesh.material) ? el.mesh.material : [el.mesh.material];
        mats.forEach((mat) => {
          if (mat) _unpatchMaterial(mat);
        });
      }
    });
  }

  function _hookUpdateGeometry() {
    if (typeof Mesh === "undefined" || !Mesh.preview_controller) return;
    if (originalUpdateGeometry) return;

    originalUpdateGeometry = Mesh.preview_controller.updateGeometry;
    Mesh.preview_controller.updateGeometry = function (element, vertex_offsets) {
      originalUpdateGeometry.call(this, element, vertex_offsets);
      _writeVertexColorsToGeometry(element);
    };
  }

  function _unhookUpdateGeometry() {
    if (originalUpdateGeometry && typeof Mesh !== "undefined" && Mesh.preview_controller) {
      Mesh.preview_controller.updateGeometry = originalUpdateGeometry;
      originalUpdateGeometry = null;
    }
  }

  /**
   * Writes per-face vertex colors to Three.js BufferGeometry.
   * Matches the exact face iteration order and <= 2 skip rule of Blockbench's updateGeometry builder.
   */
  function _writeVertexColorsToGeometry(element) {
    if (!element || !(element instanceof Mesh) || !element.faces || !element.mesh || !element.mesh.geometry) return;

    // Ensure mesh materials are patched
    if (element.mesh.material) {
      const mats = Array.isArray(element.mesh.material) ? element.mesh.material : [element.mesh.material];
      mats.forEach((mat) => {
        if (mat && !mat._vertexColorsPatched) {
          _patchMaterial(mat);
        }
      });
    }

    const geo = element.mesh.geometry;
    const positionAttr = geo.attributes.position;
    if (!positionAttr) return;

    const vertexCount = positionAttr.count;
    let colorAttr = geo.attributes.vp_color;
    if (!colorAttr || colorAttr.count !== vertexCount) {
      const colorArray = new Float32Array(vertexCount * 3);
      colorArray.fill(1.0);
      colorAttr = new THREE.BufferAttribute(colorArray, 3);
      geo.setAttribute("vp_color", colorAttr);
    }

    const colorData = colorAttr.array;
    const showColors = _isVertexColorsVisible();

    if (!showColors) {
      colorData.fill(1.0);
      colorAttr.needsUpdate = true;
      return;
    }

    let bufferIndex = 0;

    // Follow the exact same face iteration and skip rule as Blockbench updateGeometry (tris and quads only)
    for (let fkey in element.faces) {
      const face = element.faces[fkey];
      if (!face.vertices || face.vertices.length < 3 || face.vertices.length > 4) continue;

      // Iterate strictly in face.vertices order (matching updateGeometry builder)
      for (let vkey of face.vertices) {
        const c = _getFaceVertexColor(face, vkey);
        if (bufferIndex * 3 + 2 < colorData.length) {
          colorData[bufferIndex * 3 + 0] = c[0];
          colorData[bufferIndex * 3 + 1] = c[1];
          colorData[bufferIndex * 3 + 2] = c[2];
        }
        bufferIndex++;
      }
    }
    colorAttr.needsUpdate = true;
  }

  function _updateAllMeshesGeometry() {
    const meshes = typeof Mesh !== "undefined" && Mesh.all
      ? Mesh.all
      : (typeof Outliner !== "undefined" && Outliner.elements ? Outliner.elements.filter((el) => el instanceof Mesh) : []);
    meshes.forEach((part) => {
      if (part instanceof Mesh && part.faces) {
        _writeVertexColorsToGeometry(part);
      }
    });
  }

  function _cleanupAllMeshesGeometry() {
    const meshes = typeof Mesh !== "undefined" && Mesh.all
      ? Mesh.all
      : (typeof Outliner !== "undefined" && Outliner.elements ? Outliner.elements.filter((el) => el instanceof Mesh) : []);
    meshes.forEach((part) => {
      if (part instanceof Mesh && part.mesh && part.mesh.geometry) {
        if (part.mesh.geometry.attributes.vp_color) {
          delete part.mesh.geometry.attributes.vp_color;
        }
      }
    });
  }

  // =======================================================================
  // Hover & UI Feedback System
  // =======================================================================

  function _setupHoverMarker() {
    if (hoverMarker) return;
    const maxPoints = 600;
    const positions = new Float32Array(maxPoints * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));

    const mat = new THREE.PointsMaterial({
      color: 0x38bdf8, // Bright cyan hover highlight
      size: 11,
      sizeAttenuation: false,
      depthTest: false,
      transparent: true,
      opacity: 1.0,
    });

    hoverMarker = new THREE.Points(geo, mat);
    hoverMarker.renderOrder = 999;
    hoverMarker.visible = false;

    if (typeof Canvas !== "undefined" && Canvas.scene) {
      Canvas.scene.add(hoverMarker);
    }
  }

  function _removeHoverMarker() {
    if (hoverMarker) {
      if (typeof Canvas !== "undefined" && Canvas.scene) {
        Canvas.scene.remove(hoverMarker);
      }
      if (hoverMarker.geometry) hoverMarker.geometry.dispose();
      if (hoverMarker.material) hoverMarker.material.dispose();
      hoverMarker = null;
    }
  }

  function _hideHoverMarker() {
    if (hoverMarker) hoverMarker.visible = false;
  }

  function _showBrushOutline() {
    if (!brushOutlineEl) {
      brushOutlineEl = document.createElement("div");
      brushOutlineEl.id = "vertex_brush_outline";
      brushOutlineEl.style.position = "fixed";
      brushOutlineEl.style.pointerEvents = "none";
      brushOutlineEl.style.border = "2px solid rgba(56, 189, 248, 0.85)";
      brushOutlineEl.style.borderRadius = "50%";
      brushOutlineEl.style.transform = "translate(-50%, -50%)";
      brushOutlineEl.style.zIndex = "9999";
      brushOutlineEl.style.display = "none";
      document.body.appendChild(brushOutlineEl);
    }
    brushOutlineEl.style.display = "block";
  }

  function _hideBrushOutline() {
    if (brushOutlineEl) {
      brushOutlineEl.style.display = "none";
    }
  }

  function _updateHoverState(event) {
    if (
      typeof Project === "undefined" ||
      !Project ||
      !_isVertexPaintToolActive()
    ) {
      _hideHoverMarker();
      _hideBrushOutline();
      return;
    }

    const preview = Preview.selected;
    if (!preview) {
      _hideHoverMarker();
      _hideBrushOutline();
      return;
    }

    const currentToolId = Toolbox.selected.id;

    // Update 2D Cursor Brush Outline
    if (brushOutlineEl && (currentToolId === "vertex_paint" || currentToolId === "vertex_eraser")) {
      const brushSizePx =
        typeof BarItems !== "undefined" && BarItems.slider_brush_size
          ? BarItems.slider_brush_size.get()
          : 10;
      brushOutlineEl.style.left = event.clientX + "px";
      brushOutlineEl.style.top = event.clientY + "px";
      brushOutlineEl.style.width = brushSizePx * 2 + "px";
      brushOutlineEl.style.height = brushSizePx * 2 + "px";
      brushOutlineEl.style.display = "block";

      if (currentToolId === "vertex_eraser") {
        brushOutlineEl.style.borderColor = "rgba(244, 63, 94, 0.85)"; // Rose red outline for eraser
      } else {
        brushOutlineEl.style.borderColor = "rgba(56, 189, 248, 0.85)"; // Cyan for paint
      }
    } else if (brushOutlineEl) {
      brushOutlineEl.style.display = "none";
    }

    // Update 3D Hover Marker Points (Meshes Only)
    if (!hoverMarker) _setupHoverMarker();

    const previewOffset = $(preview.canvas).offset() || { left: 0, top: 0 };
    const clickPos = [
      event.clientX - previewOffset.left,
      event.clientY - previewOffset.top,
    ];

    const brushSizePx =
      (currentToolId === "vertex_paint" || currentToolId === "vertex_eraser") &&
      typeof BarItems !== "undefined" &&
      BarItems.slider_brush_size
        ? BarItems.slider_brush_size.get()
        : 12;

    const targetElements = (
      Outliner.selected && Outliner.selected.length
        ? Outliner.selected
        : Outliner.elements || []
    ).filter((el) => el instanceof Mesh);

    const tempWorldPos = new THREE.Vector3();
    const tempVec2 = new THREE.Vector2();
    const hoveredPositions = [];

    targetElements.forEach((part) => {
      if (!part.mesh || part.visibility === false || !part.vertices) return;

      for (let vkey in part.vertices) {
        tempWorldPos.fromArray(part.vertices[vkey]);
        part.mesh.localToWorld(tempWorldPos);

        const screenPos = preview.vectorToScreenPosition(tempWorldPos.clone());
        if (!screenPos) continue;

        const distPx = tempVec2
          .set(screenPos.x - clickPos[0], screenPos.y - clickPos[1])
          .length();

        if (distPx <= brushSizePx) {
          hoveredPositions.push(tempWorldPos.x, tempWorldPos.y, tempWorldPos.z);
        }
      }
    });

    if (hoveredPositions.length > 0 && hoverMarker) {
      const posAttr = hoverMarker.geometry.attributes.position;
      const count = Math.min(hoveredPositions.length / 3, posAttr.count);
      for (let i = 0; i < count * 3; i++) {
        posAttr.array[i] = hoveredPositions[i];
      }
      posAttr.needsUpdate = true;
      hoverMarker.geometry.setDrawRange(0, count);
      hoverMarker.visible = true;
    } else if (hoverMarker) {
      hoverMarker.visible = false;
    }
  }

  // =======================================================================
  // Core Data Model Helpers: Per-Face Vertex Colors
  // =======================================================================

  function _getFaceVertexColor(face, vkey) {
    if (face && face.vertex_colors && face.vertex_colors[vkey] instanceof Array) {
      return face.vertex_colors[vkey];
    }
    return [1.0, 1.0, 1.0];
  }

  function _setFaceVertexColor(face, vkey, rgb) {
    if (!face) return;
    if (!face.vertex_colors || typeof face.vertex_colors !== "object") {
      face.vertex_colors = {};
    }
    face.vertex_colors[vkey] = [rgb[0], rgb[1], rgb[2]];
  }

  function _getActiveColorRGB(useSecondary = false) {
    let hex = "#ffffff";
    if (typeof ColorPanel !== "undefined" && typeof ColorPanel.get === "function") {
      hex = ColorPanel.get(useSecondary);
    }
    return _hexToRgb(hex);
  }

  function _hexToRgb(hex) {
    if (!hex || typeof hex !== "string") return [1.0, 1.0, 1.0];
    let c = hex.replace("#", "");
    if (c.length === 3) {
      c = c.split("").map((char) => char + char).join("");
    }
    const num = parseInt(c, 16);
    if (isNaN(num)) return [1.0, 1.0, 1.0];
    return [
      ((num >> 16) & 255) / 255,
      ((num >> 8) & 255) / 255,
      (num & 255) / 255,
    ];
  }

  function _isVertexPaintToolActive() {
    return (
      typeof Toolbox !== "undefined" &&
      Toolbox.selected &&
      (Toolbox.selected.id === "vertex_paint" ||
        Toolbox.selected.id === "vertex_bucket" ||
        Toolbox.selected.id === "vertex_eraser")
    );
  }

  // =======================================================================
  // Tool 1 & Tool 3: Brush & Eraser Stroke Handling (Meshes Only)
  // =======================================================================
  function _handleBrushStroke(data, isEraser = false) {
    const preview = Preview.selected;
    if (!preview) return;

    let targetElements = [];
    if (data.element && data.element instanceof Mesh) {
      targetElements = [data.element];
    } else if (Outliner.selected && Outliner.selected.length) {
      targetElements = Outliner.selected.filter((el) => el instanceof Mesh);
    } else {
      targetElements = (Outliner.elements || []).filter((el) => el instanceof Mesh);
    }

    if (!targetElements.length) return;

    Undo.initEdit({ elements: targetElements });

    const draw = (event, clickData) => {
      const mouseEvent = event || (clickData ? clickData.event : null);
      if (!mouseEvent) return;

      const previewOffset = $(preview.canvas).offset() || { left: 0, top: 0 };
      const clickPos = [
        mouseEvent.clientX - previewOffset.left,
        mouseEvent.clientY - previewOffset.top,
      ];

      const useSecondaryColor =
        mouseEvent.altKey || (typeof Pressing !== "undefined" && Pressing.overrides.alt);
      const isCtrlEraser =
        mouseEvent.ctrlKey || (typeof Pressing !== "undefined" && Pressing.overrides.ctrl);

      // Eraser sets target color to neutral white [1, 1, 1]
      const targetRGB = isEraser || isCtrlEraser ? [1.0, 1.0, 1.0] : _getActiveColorRGB(useSecondaryColor);

      const rawBrushSize =
        typeof BarItems !== "undefined" && BarItems.slider_brush_size
          ? BarItems.slider_brush_size.get()
          : 25;
      const brushSizePx = Math.max(rawBrushSize, 10);
      const softnessFactor =
        typeof BarItems !== "undefined" && BarItems.slider_brush_softness
          ? BarItems.slider_brush_softness.get() / 100
          : 0.5;

      const maxOpacity =
        typeof BarItems !== "undefined" &&
        BarItems.slider_brush_opacity &&
        BarItems.slider_brush_opacity.settings
          ? BarItems.slider_brush_opacity.settings.max
          : (typeof settings !== "undefined" &&
             settings.opacity_range &&
             settings.opacity_range.value === "255"
              ? 255
              : 100);

      const opacityFactor =
        typeof BarItems !== "undefined" && BarItems.slider_brush_opacity
          ? BarItems.slider_brush_opacity.get() / maxOpacity
          : 1.0;

      const tempWorldPos = new THREE.Vector3();
      const tempVec2 = new THREE.Vector2();

      targetElements.forEach((part) => {
        if (!part.mesh || !part.vertices || !part.faces) return;
        let modified = false;

        for (let vkey in part.vertices) {
          tempWorldPos.fromArray(part.vertices[vkey]);
          part.mesh.localToWorld(tempWorldPos);

          const screenPos = preview.vectorToScreenPosition(tempWorldPos.clone());
          if (!screenPos) continue;

          const distPx = tempVec2
            .set(screenPos.x - clickPos[0], screenPos.y - clickPos[1])
            .length();

          if (distPx <= brushSizePx) {
            let falloff = 1.0;
            if (softnessFactor > 0) {
              const innerRadius = brushSizePx * (1.0 - softnessFactor);
              if (distPx > innerRadius) {
                const t = (distPx - innerRadius) / (brushSizePx - innerRadius);
                falloff = 1.0 - Math.min(Math.max(t, 0), 1);
                falloff = falloff * falloff * (3 - 2 * falloff);
              }
            }

            const alpha = falloff * opacityFactor;

            // Apply per-face color to every face referencing this vertex key
            for (let fkey in part.faces) {
              const face = part.faces[fkey];
              if (face.vertices && face.vertices.includes(vkey)) {
                const currColor = _getFaceVertexColor(face, vkey);
                const newColor = [
                  currColor[0] + (targetRGB[0] - currColor[0]) * alpha,
                  currColor[1] + (targetRGB[1] - currColor[1]) * alpha,
                  currColor[2] + (targetRGB[2] - currColor[2]) * alpha,
                ];
                _setFaceVertexColor(face, vkey, newColor);
                modified = true;
              }
            }
          }
        }

        if (modified) {
          _writeVertexColorsToGeometry(part);
        }
      });

      _updateHoverState(mouseEvent);
    };

    const stop = () => {
      document.removeEventListener("pointermove", draw);
      document.removeEventListener("pointerup", stop);
      Undo.finishEdit(isEraser ? "Vertex Paint Eraser" : "Vertex Paint Tool");
    };

    document.addEventListener("pointermove", draw);
    document.addEventListener("pointerup", stop);
    draw(data.event, data);
  }

  // =======================================================================
  // Tool 2: Bucket Fill Handling (Meshes Only)
  // =======================================================================
  function _handleBucketFill(data) {
    let targetElements = [];
    if (data.element && data.element instanceof Mesh) {
      targetElements = [data.element];
    } else if (Outliner.selected && Outliner.selected.length) {
      targetElements = Outliner.selected.filter((el) => el instanceof Mesh);
    } else {
      targetElements = (Outliner.elements || []).filter((el) => el instanceof Mesh);
    }

    if (!targetElements.length) return;

    Undo.initEdit({ elements: targetElements });

    const useSecondaryColor = data.event
      ? data.event.altKey || (typeof Pressing !== "undefined" && Pressing.overrides.alt)
      : false;
    const targetRGB = _getActiveColorRGB(useSecondaryColor);

    const maxOpacity =
      typeof BarItems !== "undefined" &&
      BarItems.slider_brush_opacity &&
      BarItems.slider_brush_opacity.settings
        ? BarItems.slider_brush_opacity.settings.max
        : (typeof settings !== "undefined" &&
           settings.opacity_range &&
           settings.opacity_range.value === "255"
            ? 255
            : 100);

    const opacityFactor =
      typeof BarItems !== "undefined" && BarItems.slider_brush_opacity
        ? BarItems.slider_brush_opacity.get() / maxOpacity
        : 1.0;

    targetElements.forEach((part) => {
      if (!part.mesh || !part.faces || !part.vertices) return;

      const selectedVerts = part.getSelectedVertices ? part.getSelectedVertices() : [];
      const selectedFaces = part.getSelectedFaces ? part.getSelectedFaces() : [];

      if (selectedFaces.length > 0) {
        // Color specific selected faces
        selectedFaces.forEach((fkey) => {
          const face = part.faces[fkey];
          if (face && face.vertices) {
            face.vertices.forEach((vkey) => {
              const currColor = _getFaceVertexColor(face, vkey);
              const newColor = [
                currColor[0] + (targetRGB[0] - currColor[0]) * opacityFactor,
                currColor[1] + (targetRGB[1] - currColor[1]) * opacityFactor,
                currColor[2] + (targetRGB[2] - currColor[2]) * opacityFactor,
              ];
              _setFaceVertexColor(face, vkey, newColor);
            });
          }
        });
      } else if (selectedVerts.length > 0) {
        // Color all faces sharing selected vertices
        selectedVerts.forEach((vkey) => {
          for (let fkey in part.faces) {
            const face = part.faces[fkey];
            if (face.vertices && face.vertices.includes(vkey)) {
              const currColor = _getFaceVertexColor(face, vkey);
              const newColor = [
                currColor[0] + (targetRGB[0] - currColor[0]) * opacityFactor,
                currColor[1] + (targetRGB[1] - currColor[1]) * opacityFactor,
                currColor[2] + (targetRGB[2] - currColor[2]) * opacityFactor,
              ];
              _setFaceVertexColor(face, vkey, newColor);
            }
          }
        });
      } else if (data.face && data.face.vertices) {
        // Clicked a single face
        data.face.vertices.forEach((vkey) => {
          const currColor = _getFaceVertexColor(data.face, vkey);
          const newColor = [
            currColor[0] + (targetRGB[0] - currColor[0]) * opacityFactor,
            currColor[1] + (targetRGB[1] - currColor[1]) * opacityFactor,
            currColor[2] + (targetRGB[2] - currColor[2]) * opacityFactor,
          ];
          _setFaceVertexColor(data.face, vkey, newColor);
        });
      } else {
        // Color entire mesh (all faces)
        for (let fkey in part.faces) {
          const face = part.faces[fkey];
          if (face.vertices) {
            face.vertices.forEach((vkey) => {
              const currColor = _getFaceVertexColor(face, vkey);
              const newColor = [
                currColor[0] + (targetRGB[0] - currColor[0]) * opacityFactor,
                currColor[1] + (targetRGB[1] - currColor[1]) * opacityFactor,
                currColor[2] + (targetRGB[2] - currColor[2]) * opacityFactor,
              ];
              _setFaceVertexColor(face, vkey, newColor);
            });
          }
        }
      }

      _writeVertexColorsToGeometry(part);
    });

    Undo.finishEdit("Vertex Paint Bucket");
  }
})();
