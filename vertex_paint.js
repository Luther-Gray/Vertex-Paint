Plugin.register("vertex_paint", {
  title: "Vertex Paint",
  author: "Luther Gray",
  icon: "vertexPaintIcon.png",
  about:
    "# 👁️ Vertex Paint \n\
  Vertex Paint is a Blockbench Plugin that finally delivers the missing feature of, well, Vertex Painting. It features everything from brush sizes, falloff, and multi-vertex coloring!\n\
  ## 🖥️🌐 Install\n\
  Installation is the same as every other Blockbench Plugin. Simply grab it from the Plugin Store, or Load the Plugin from the Javascript (`vertex_paintjs`) file.",
  description:
    "Vertex Paint is a Blockbench Plugin that finally delivers the missing feature of, well, Vertex Painting. It features everything from brush sizes, falloff, and multi-vertex coloring!",
  version: "1.0.0",
  min_version: "4.8.0",
  variant: "both",

  onload() {
    // WIP - New Tool - Vertex Paint
    this.vertexPaintTool = new Tool("vertex_paint", {
      id: "vertex_paint",
      name: "Vertex Paint",
      icon: "fa-circle-nodes",
      description: "Paint vertices within the Brush Radius.",
      category: "tools",
      toolbar: "brush",
      paintTool: true,
      cursor: "crosshair",
      selectFace: false,
      transformerMode: "hidden",
      allowed_view_modes: ["textured", "material"],
      modes: ["paint"],
      brush: {
        size: true,
        softness: true,
        opacity: true,
        brush_shape: true,
        blend_mode: true,
        mirror_painting: true,
        lock_alpha: false,
        painting_grid: false,
        image_tiled_view: false,
      },
      //---
      // Functionality
      //---
      //onCanvasClick(vertex){}
      // What happens when you select the Vertex Paint Tool?
      onSelect() {
        // Step 1 - Store Current Preview Settings
        this._savedWireframe = Canvas.wireframe;
        this._savedVerts = Canvas.nodes;
        this._savedPaintGrid = settings.painting_grid.value;
        // Step 2 - Change Preview Settings for this tool.
        Canvas.wireframe = true;
        Canvas.nodes = true;
        settings.painting_grid.value = false;
        // Step 3 - Apply Settings
        Canvas.updatePixelGrid();
      },
      // And what happens when you deselect the Vertex Paint Tool?
      onUnselect() {
        Canvas.wireframe = this._savedWireframe;
        Canvas.nodes = this._savedVerts;
        settings.painting_grid.value = this._savedPaintGrid;
        Canvas.updatePixelGrid();
      },
    });

    // TODO - New Tool - Vertex Bucket
    this.vertexBucketTool = new Tool("vertex_bucket", {
      id: "vertex_bucket",
      name: "Vertex Bucket",
      icon: "hexagon-nodes",
      description: "Paint a selected group of verticies.",
      category: "tools",
      toolbar: "brush",
      paintTool: true,
      cursor: "crosshair",
      selectFace: false,
      transformerMode: "hidden",
      modes: ["paint"],
      brush: {
        opacity: true,
        blend_mode: true,
        lock_alpha: false,
        painting_grid: false,
        image_tiled_view: false,
      },
      //---
      // Functionality
      //---
      //onCanvasClick(vertex){}
      //onSelect(){}
    });
  },
  // Clean Up
  onunload() {
    if (this.vertexPaintTool) this.vertexPaintTool.delete();
    if (this.vertexBucketTool) this.vertexBucketTool.delete();
  },
});
