(function () {
  let onUndoRedoHandler = null;
  let eventListeners = [];
  let hoverMarker = null;
  let brushOutlineEl = null;

  // Dedicated Three.js Material for Vertex Painting (Same approach as Blockbench Weight Painting)
  let vertexPaintMaterial = null;
  function _getVertexPaintMaterial() {
    if (!vertexPaintMaterial && typeof THREE !== "undefined") {
      vertexPaintMaterial = new THREE.MeshLambertMaterial({
        color: 0xffffff,
        side: THREE.DoubleSide,
        vertexColors: true,
      });
    }
    return vertexPaintMaterial;
  }

  Plugin.register("vertex_paint", {
    title: "Vertex Paint",
    author: "Luther Gray",
    icon: "fa-circle-nodes",
    description:
      "Vertex painting plugin for Blockbench using native color palettes, brush size, softness falloff, opacity control, bucket fill, eraser, and display toggle.",
    about:
      "# 👁️ Vertex Paint\n" +
      "Vertex Paint brings native 3D vertex painting to Blockbench! It features three dedicated tools and full viewport controls:\n\n" +
      "1. **Vertex Paint Tool**: Paint vertices using standard brush size, softness falloff, and opacity controls.\n" +
      "2. **Vertex Paint Bucket**: Instantly fill selected vertices, faces, or elements using your active palette color and opacity settings.\n" +
      "3. **Vertex Paint Eraser**: Cleanly erase vertex colors back to neutral white with brush size and opacity falloff.\n\n" +
      "Includes a **Toggle Vertex Colors (Eye Icon)** view setting in the View Menu to switch vertex color visibility on/off at any time.",
    version: "1.4.0",
    min_version: "4.8.0",
    variant: "both",

    onload() {
      _setupHoverMarker();

      // -------------------------------------------------------------------
      // 0. Toggle Vertex Colors (Eye Icon View Setting)
      // -------------------------------------------------------------------
      this.toggleVertexColors = new Toggle("toggle_vertex_colors", {
        name: "Toggle Vertex Colors",
        description: "Show or hide Vertex Colors in the 3D viewport",
        icon: "fa-eye",
        category: "view",
        default: true,
        onChange: (value) => {
          if (value) {
            _activateVertexPaintMode();
          } else if (!_isVertexPaintToolActive()) {
            _deactivateVertexPaintMode();
          }
        },
      });
      MenuBar.addAction(this.toggleVertexColors, "view");

      // -------------------------------------------------------------------
      // 1. Tool 1: Vertex Paint Tool (Paint Mode Only)
      // -------------------------------------------------------------------
      this.vertexPaintTool = new Tool("vertex_paint", {
        id: "vertex_paint",
        name: "Vertex Paint Tool",
        icon: "fa-circle-nodes",
        description: "Paint mesh & cube vertices with brush size, falloff, and opacity.",
        category: "tools",
        toolbar: "brush",
        paintTool: false, // Prevents 2D texture pixel grid square box
        cursor: "crosshair",
        selectFace: false,
        transformerMode: "hidden",
        allowed_view_modes: ["textured", "solid", "material", "wireframe"],
        modes: ["paint"], // Paint Mode ONLY

        brush: {
          size: true,
          softness: true,
          opacity: true,
        },

        onSelect() {
          _activateVertexPaintMode();
          _showBrushOutline();
          document.addEventListener("pointermove", _updateHoverState);
        },

        onUnselect: () => {
          if (!this.toggleVertexColors || !this.toggleVertexColors.value) {
            _deactivateVertexPaintMode();
          }
          _hideHoverMarker();
          _hideBrushOutline();
          document.removeEventListener("pointermove", _updateHoverState);
        },

        onCanvasClick: (data) => {
          _handleBrushStroke(data, false);
        },
      });

      // -------------------------------------------------------------------
      // 2. Tool 2: Vertex Paint Bucket (Paint Mode Only)
      // -------------------------------------------------------------------
      this.vertexBucketTool = new Tool("vertex_bucket", {
        id: "vertex_bucket",
        name: "Vertex Paint Bucket",
        icon: "fa-fill-drip",
        description: "Color all selected vertices, faces, or elements in one click.",
        category: "tools",
        toolbar: "brush",
        paintTool: false, // Prevents 2D texture pixel grid square box
        cursor: "crosshair",
        selectFace: true,
        transformerMode: "hidden",
        allowed_view_modes: ["textured", "solid", "material", "wireframe"],
        modes: ["paint"], // Paint Mode ONLY

        brush: {
          opacity: true,
        },

        onSelect() {
          _activateVertexPaintMode();
          document.addEventListener("pointermove", _updateHoverState);
        },

        onUnselect: () => {
          if (!this.toggleVertexColors || !this.toggleVertexColors.value) {
            _deactivateVertexPaintMode();
          }
          _hideHoverMarker();
          document.removeEventListener("pointermove", _updateHoverState);
        },

        onCanvasClick: (data) => {
          _handleBucketFill(data);
        },
      });

      // -------------------------------------------------------------------
      // 3. Tool 3: Vertex Paint Eraser (Paint Mode Only)
      // -------------------------------------------------------------------
      this.vertexEraserTool = new Tool("vertex_eraser", {
        id: "vertex_eraser",
        name: "Vertex Paint Eraser",
        icon: "fa-eraser",
        description: "Erase vertex colors back to neutral white with brush size and opacity falloff.",
        category: "tools",
        toolbar: "brush",
        paintTool: false,
        cursor: "crosshair",
        selectFace: false,
        transformerMode: "hidden",
        allowed_view_modes: ["textured", "solid", "material", "wireframe"],
        modes: ["paint"], // Paint Mode ONLY

        brush: {
          size: true,
          softness: true,
          opacity: true,
        },

        onSelect() {
          _activateVertexPaintMode();
          _showBrushOutline();
          document.addEventListener("pointermove", _updateHoverState);
        },

        onUnselect: () => {
          if (!this.toggleVertexColors || !this.toggleVertexColors.value) {
            _deactivateVertexPaintMode();
          }
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
      // 4. Blockbench Event Synchronization (Textures, Geometry, Views)
      // -------------------------------------------------------------------
      const registerBBEvent = (name, handler) => {
        Blockbench.on(name, handler);
        eventListeners.push({ name, handler });
      };

      onUndoRedoHandler = () => {
        if (_isVertexPaintActive(this.toggleVertexColors)) {
          _initializeAllElementColors();
        }
      };
      registerBBEvent("undo", onUndoRedoHandler);
      registerBBEvent("redo", onUndoRedoHandler);

      const recompileHandler = () => {
        if (typeof Project !== "undefined" && Project) {
          if (_isVertexPaintActive(this.toggleVertexColors)) {
            _initializeAllElementColors();
          }
        }
      };
      // Recompile on texture add/delete, view mode changes, geometry updates
      registerBBEvent("add_texture", recompileHandler);
      registerBBEvent("remove_texture", recompileHandler);
      registerBBEvent("delete_texture", recompileHandler);
      registerBBEvent("change_view_mode", recompileHandler);
      registerBBEvent("update_geometry", recompileHandler);
      registerBBEvent("update_selection", recompileHandler);
      registerBBEvent("update_view", recompileHandler);

      const projectCloseHandler = () => {
        _deactivateVertexPaintMode();
        _hideBrushOutline();
        _hideHoverMarker();
      };
      registerBBEvent("unload_project", projectCloseHandler);
      registerBBEvent("close_project", projectCloseHandler);
      registerBBEvent("select_project", projectCloseHandler);
    },

    onunload() {
      eventListeners.forEach(({ name, handler }) => {
        Blockbench.removeListener(name, handler);
      });
      eventListeners = [];
      onUndoRedoHandler = null;

      document.removeEventListener("pointermove", _updateHoverState);
      _deactivateVertexPaintMode();
      _removeHoverMarker();
      _hideBrushOutline();

      if (this.toggleVertexColors) this.toggleVertexColors.delete();
      if (this.vertexPaintTool) this.vertexPaintTool.delete();
      if (this.vertexBucketTool) this.vertexBucketTool.delete();
      if (this.vertexEraserTool) this.vertexEraserTool.delete();
    },
  });

  // =======================================================================
  // Mode Activation & Display Management
  // =======================================================================

  function _isVertexPaintToolActive() {
    return (
      typeof Toolbox !== "undefined" &&
      Toolbox.selected &&
      (Toolbox.selected.id === "vertex_paint" ||
        Toolbox.selected.id === "vertex_bucket" ||
        Toolbox.selected.id === "vertex_eraser")
    );
  }

  function _isVertexPaintActive(toggleAction) {
    return (
      _isVertexPaintToolActive() || (toggleAction && toggleAction.value === true)
    );
  }

  function _activateVertexPaintMode() {
    _initializeAllElementColors();
    _showAllModelVertices();
    _hidePixelGridSquare();
  }

  function _deactivateVertexPaintMode() {
    _restoreOriginalMaterials();
    _hideAllModelVertices();
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

  function _hidePixelGridSquare() {
    if (typeof Canvas !== "undefined" && Canvas.brush_outline) {
      if (Canvas.scene) Canvas.scene.remove(Canvas.brush_outline);
      Canvas.brush_outline.visible = false;
    }
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

  function _showAllModelVertices() {
    const elements = Outliner.elements || [];
    elements.forEach((part) => {
      if (!part.mesh) return;

      if (part.mesh.vertex_points) {
        part.mesh.vertex_points.visible = true;
      }

      if (!part._vertexDotsMesh) {
        const vertices = _getElementVertices(part);
        const posArray = [];
        for (let vkey in vertices) {
          const v = vertices[vkey];
          posArray.push(v[0], v[1], v[2]);
        }

        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(posArray), 3));
        const mat = new THREE.PointsMaterial({
          color: 0x0284c7, // Distinct blue dot for all non-hovered model vertices
          size: 6,
          sizeAttenuation: false,
          depthTest: false,
          transparent: true,
          opacity: 0.8,
        });

        part._vertexDotsMesh = new THREE.Points(geo, mat);
        part._vertexDotsMesh.renderOrder = 998;
        part.mesh.add(part._vertexDotsMesh);
      }
      part._vertexDotsMesh.visible = true;
    });
  }

  function _hideAllModelVertices() {
    const elements = Outliner.elements || [];
    elements.forEach((part) => {
      if (part.mesh && part.mesh.vertex_points) {
        if (typeof Mode !== "undefined" && Mode.selected && Mode.selected.id === "paint") {
          part.mesh.vertex_points.visible = false;
        }
      }
      if (part._vertexDotsMesh) {
        part._vertexDotsMesh.visible = false;
      }
    });
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

    // Update 3D Hover Marker Points
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

    const targetElements =
      Outliner.selected && Outliner.selected.length
        ? Outliner.selected
        : Outliner.elements || [];

    const tempWorldPos = new THREE.Vector3();
    const tempVec2 = new THREE.Vector2();
    const hoveredPositions = [];

    targetElements.forEach((part) => {
      if (!part.mesh || part.visibility === false) return;
      const vertices = _getElementVertices(part);

      for (let vkey in vertices) {
        tempWorldPos.fromArray(vertices[vkey]);
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
  // Core Logic & Element Helper Functions
  // =======================================================================

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

  function _getElementVertices(part) {
    if (part.vertices) return part.vertices;
    if (part instanceof Cube) {
      const f = part.from, t = part.to;
      return {
        v0: [f[0], f[1], f[2]],
        v1: [t[0], f[1], f[2]],
        v2: [t[0], t[1], f[2]],
        v3: [f[0], t[1], f[2]],
        v4: [f[0], f[1], t[2]],
        v5: [t[0], f[1], t[2]],
        v6: [t[0], t[1], t[2]],
        v7: [f[0], t[1], t[2]],
      };
    }
    return {};
  }

  function _initializeAllElementColors() {
    const elements = Outliner.elements || [];
    elements.forEach((part) => {
      _initVertexColors(part);
    });
  }

  function _initVertexColors(part) {
    if (!part.vertexColors) {
      part.vertexColors = {};
    }
    const vertices = _getElementVertices(part);
    for (let vertexID in vertices) {
      if (!part.vertexColors[vertexID]) {
        part.vertexColors[vertexID] = [1.0, 1.0, 1.0];
      }
    }
    if (part.mesh) {
      _compileVertexColors(part);
    }
  }

  function _buildVertexMap(part) {
    const vertexMap = {};
    let currentBufferIndex = 0;

    if (part.faces) {
      for (let faceID in part.faces) {
        const face = part.faces[faceID];
        const vList = face.vertices || (face.getSortedVertices ? face.getSortedVertices() : null);
        if (vList) {
          for (let vertexID of vList) {
            if (!vertexMap[vertexID]) vertexMap[vertexID] = [];
            vertexMap[vertexID].push(currentBufferIndex);
            currentBufferIndex++;
          }
        }
      }
    } else {
      const vertices = _getElementVertices(part);
      let idx = 0;
      for (let vkey in vertices) {
        vertexMap[vkey] = [idx++];
      }
    }
    return vertexMap;
  }

  /**
   * Binds vertex color buffer attributes to Three.js BufferGeometry and assigns vertex paint material.
   */
  function _compileVertexColors(part) {
    if (!part.mesh || !part.mesh.geometry) return;

    const geo = part.mesh.geometry;
    const vertexCount = geo.attributes.position ? geo.attributes.position.count : 0;
    if (!vertexCount) return;

    const vertexMap = _buildVertexMap(part);

    let colorAttr = geo.attributes.color;
    if (!colorAttr || colorAttr.count !== vertexCount) {
      const colorArray = new Float32Array(vertexCount * 3);
      colorArray.fill(1.0);
      colorAttr = new THREE.BufferAttribute(colorArray, 3);
      geo.setAttribute("color", colorAttr);
    }

    const colorData = colorAttr.array;
    for (let vertexID in part.vertexColors) {
      const [r, g, b] = part.vertexColors[vertexID];
      const colorIndices = vertexMap[vertexID] || [];
      for (let cIndex of colorIndices) {
        if (cIndex * 3 + 2 < colorData.length) {
          colorData[cIndex * 3 + 0] = r;
          colorData[cIndex * 3 + 1] = g;
          colorData[cIndex * 3 + 2] = b;
        }
      }
    }
    colorAttr.needsUpdate = true;

    // Apply Vertex Paint Material (Weight Painting approach) to guarantee vertex color rendering on all models
    if (part.mesh) {
      if (!part._originalMaterial && part.mesh.material) {
        part._originalMaterial = part.mesh.material;
      }
      part.mesh.material = _getVertexPaintMaterial();
      part.mesh.material.needsUpdate = true;
    }
  }

  function _restoreOriginalMaterials() {
    const elements = Outliner.elements || [];
    elements.forEach((part) => {
      if (part.mesh && part._originalMaterial) {
        part.mesh.material = part._originalMaterial;
        delete part._originalMaterial;
      }
    });
  }

  // =======================================================================
  // Tool 1 & Tool 3 Implementation: Brush & Eraser Stroke Handling
  // =======================================================================
  function _handleBrushStroke(data, isEraser = false) {
    const preview = Preview.selected;
    if (!preview) return;

    let targetElements = [];
    if (data.element) {
      targetElements = [data.element];
    } else if (Outliner.selected && Outliner.selected.length) {
      targetElements = Outliner.selected;
    } else {
      targetElements = Outliner.elements || [];
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

      const brushSizePx =
        typeof BarItems !== "undefined" && BarItems.slider_brush_size
          ? BarItems.slider_brush_size.get()
          : 10;
      const softnessFactor =
        typeof BarItems !== "undefined" && BarItems.slider_brush_softness
          ? BarItems.slider_brush_softness.get() / 100
          : 0.5;
      const opacityFactor =
        typeof BarItems !== "undefined" && BarItems.slider_brush_opacity
          ? BarItems.slider_brush_opacity.get() / 255
          : 1.0;

      const tempWorldPos = new THREE.Vector3();
      const tempVec2 = new THREE.Vector2();

      targetElements.forEach((part) => {
        if (!part.mesh) return;
        _initVertexColors(part);

        const vertices = _getElementVertices(part);
        let modified = false;

        for (let vkey in vertices) {
          tempWorldPos.fromArray(vertices[vkey]);
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
            const currColor = part.vertexColors[vkey] || [1.0, 1.0, 1.0];

            part.vertexColors[vkey] = [
              currColor[0] + (targetRGB[0] - currColor[0]) * alpha,
              currColor[1] + (targetRGB[1] - currColor[1]) * alpha,
              currColor[2] + (targetRGB[2] - currColor[2]) * alpha,
            ];
            modified = true;
          }
        }

        if (modified) {
          _compileVertexColors(part);
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
  // Tool 2 Implementation: Bucket Fill Handling
  // =======================================================================
  function _handleBucketFill(data) {
    let targetElements = [];
    if (data.element) {
      targetElements = [data.element];
    } else if (Outliner.selected && Outliner.selected.length) {
      targetElements = Outliner.selected;
    } else {
      targetElements = Outliner.elements || [];
    }

    if (!targetElements.length) return;

    Undo.initEdit({ elements: targetElements });

    const useSecondaryColor = data.event
      ? data.event.altKey || (typeof Pressing !== "undefined" && Pressing.overrides.alt)
      : false;
    const targetRGB = _getActiveColorRGB(useSecondaryColor);
    const opacityFactor =
      typeof BarItems !== "undefined" && BarItems.slider_brush_opacity
        ? BarItems.slider_brush_opacity.get() / 255
        : 1.0;

    targetElements.forEach((part) => {
      if (!part.mesh) return;
      _initVertexColors(part);

      const vertices = _getElementVertices(part);
      const selectedVerts = part.getSelectedVertices ? part.getSelectedVertices() : [];
      const selectedFaces = part.getSelectedFaces ? part.getSelectedFaces() : [];

      let vkeysToColor = [];

      if (selectedVerts.length > 0) {
        vkeysToColor = selectedVerts;
      } else if (selectedFaces.length > 0) {
        const vSet = new Set();
        selectedFaces.forEach((fkey) => {
          const face = part.faces[fkey];
          if (face && face.vertices) {
            face.vertices.forEach((vk) => vSet.add(vk));
          }
        });
        vkeysToColor = Array.from(vSet);
      } else if (data.face && data.face.vertices) {
        vkeysToColor = data.face.vertices;
      } else {
        vkeysToColor = Object.keys(vertices);
      }

      vkeysToColor.forEach((vkey) => {
        const currColor = part.vertexColors[vkey] || [1.0, 1.0, 1.0];
        part.vertexColors[vkey] = [
          currColor[0] + (targetRGB[0] - currColor[0]) * opacityFactor,
          currColor[1] + (targetRGB[1] - currColor[1]) * opacityFactor,
          currColor[2] + (targetRGB[2] - currColor[2]) * opacityFactor,
        ];
      });

      _compileVertexColors(part);
    });

    Undo.finishEdit("Vertex Paint Bucket");
  }
})();
