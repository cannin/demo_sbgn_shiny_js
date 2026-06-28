(function () {
  "use strict";

  const COMPLEX_NODE_SELECTOR = 'node[class *= "complex"]';
  const COMPARTMENT_NODE_SELECTOR = 'node[class = "compartment"]';
  const renderers = {};

  function getNodeDimension(ele, key, fallback) {
    const bbox = ele.data("bbox");
    const value = bbox && Number(bbox[key]);
    return Number.isFinite(value) && value > 0 ? value : fallback;
  }

  function setMessage(renderer, text) {
    renderer.message.textContent = text || "";
    renderer.message.hidden = !text;
  }

  function setShinyInput(name, value) {
    if (!window.Shiny) {
      return;
    }

    if (typeof Shiny.setInputValue === "function") {
      Shiny.setInputValue(name, value, { priority: "event" });
      return;
    }

    if (typeof Shiny.onInputChange === "function") {
      Shiny.onInputChange(name, value);
    }
  }

  function notifyShinyReady() {
    setShinyInput("cytoscape_ready", true);
  }

  function directChildrenByTag(element, tagName) {
    return Array.from(element.children).filter((child) => child.localName === tagName);
  }

  function firstDirectChildByTag(element, tagName) {
    return directChildrenByTag(element, tagName)[0] || null;
  }

  function getGlyphLabel(glyph) {
    const label = firstDirectChildByTag(glyph, "label");
    return label ? label.getAttribute("text") || "" : "";
  }

  function getGlyphBbox(glyph) {
    const bbox = firstDirectChildByTag(glyph, "bbox");
    if (!bbox) {
      return { x: 0, y: 0, w: 60, h: 30 };
    }

    const x = Number.parseFloat(bbox.getAttribute("x") || "0");
    const y = Number.parseFloat(bbox.getAttribute("y") || "0");
    const w = Number.parseFloat(bbox.getAttribute("w") || "60");
    const h = Number.parseFloat(bbox.getAttribute("h") || "30");
    return {
      x: x + w / 2,
      y: y + h / 2,
      w,
      h,
    };
  }

  function getRdfAttribute(element, localName) {
    return (
      element.getAttributeNS("http://www.w3.org/1999/02/22-rdf-syntax-ns#", localName) ||
      element.getAttribute(`rdf:${localName}`) ||
      element.getAttribute(localName) ||
      ""
    );
  }

  function getGlyphResources(glyph, glyphId) {
    const resources = [];
    Array.from(glyph.getElementsByTagNameNS("*", "Description")).forEach((description) => {
      const about = getRdfAttribute(description, "about").replace(/^#/, "");
      if (about && about !== glyphId) {
        return;
      }

      Array.from(description.getElementsByTagNameNS("*", "li")).forEach((item) => {
        const resource = getRdfAttribute(item, "resource");
        if (resource && !resources.includes(resource)) {
          resources.push(resource);
        }
      });
    });
    return resources;
  }

  function collectSbgnXmlExtras(xmlText, graph) {
    const parser = new DOMParser();
    const xml = parser.parseFromString(xmlText, "application/xml");
    if (xml.querySelector("parsererror")) {
      throw new Error("Could not parse SBGN XML.");
    }

    const nodes = graph.nodes ? graph.nodes.slice() : [];
    const edges = graph.edges ? graph.edges.slice() : [];
    const nodeIds = new Set(nodes.map((node) => node.data && node.data.id).filter(Boolean));
    const edgeIds = new Set(edges.map((edge) => edge.data && edge.data.id).filter(Boolean));
    const annotationById = new Map();
    const portToGlyph = new Map();

    function visitGlyph(glyph, parentId) {
      const id = glyph.getAttribute("id");
      const glyphClass = glyph.getAttribute("class") || "";
      if (!id) {
        return;
      }

      const resources = getGlyphResources(glyph, id);
      if (resources.length > 0) {
        annotationById.set(id, resources);
      }

      directChildrenByTag(glyph, "port").forEach((port) => {
        const portId = port.getAttribute("id");
        if (portId) {
          portToGlyph.set(portId, id);
        }
      });

      const isAuxiliary = glyphClass === "state variable" || glyphClass === "unit of information";
      if (!isAuxiliary && !nodeIds.has(id)) {
        const bbox = getGlyphBbox(glyph);
        nodes.push({
          data: {
            id,
            class: glyphClass,
            label: getGlyphLabel(glyph),
            parent: glyph.getAttribute("compartmentRef") || parentId || "",
            clonemarker: firstDirectChildByTag(glyph, "clone") !== null,
            stateVariables: [],
            unitsOfInformation: [],
            annotations: resources,
            bbox,
          },
          position: { x: bbox.x, y: bbox.y },
        });
        nodeIds.add(id);
      }

      directChildrenByTag(glyph, "glyph").forEach((child) => visitGlyph(child, id));
    }

    Array.from(xml.getElementsByTagNameNS("*", "map")).forEach((map) => {
      directChildrenByTag(map, "glyph").forEach((glyph) => visitGlyph(glyph, ""));
    });

    nodes.forEach((node) => {
      if (!node.data || !node.data.id) {
        return;
      }
      node.data.annotations = annotationById.get(node.data.id) || [];
    });

    Array.from(xml.getElementsByTagNameNS("*", "arc")).forEach((arc, index) => {
      const id = arc.getAttribute("id") || `arc-${index}`;
      if (edgeIds.has(id)) {
        return;
      }

      const source = portToGlyph.get(arc.getAttribute("source")) || arc.getAttribute("source");
      const target = portToGlyph.get(arc.getAttribute("target")) || arc.getAttribute("target");
      if (!source || !target || !nodeIds.has(source) || !nodeIds.has(target)) {
        return;
      }

      edges.push({
        data: {
          id,
          class: arc.getAttribute("class") || "",
          source,
          target,
        },
      });
      edgeIds.add(id);
    });

    return nodes.concat(edges);
  }

  function normalizeGeneLabel(text) {
    return String(text || "").trim();
  }

  function textColorForFill(hexColor) {
    const match = String(hexColor || "").match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
    if (!match) {
      return "#1f2933";
    }

    const red = Number.parseInt(match[1], 16) / 255;
    const green = Number.parseInt(match[2], 16) / 255;
    const blue = Number.parseInt(match[3], 16) / 255;
    const linear = [red, green, blue].map((channel) => {
      return channel <= 0.03928
        ? channel / 12.92
        : ((channel + 0.055) / 1.055) ** 2.4;
    });
    const luminance = 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
    return luminance < 0.45 ? "#ffffff" : "#1f2933";
  }

  function applyHighlights(cy, highlightedGenes) {
    const highlightMap = new Map();
    (highlightedGenes || []).forEach((item) => {
      if (item && item.gene && item.color) {
        highlightMap.set(normalizeGeneLabel(item.gene), item.color);
      }
    });

    let matchCount = 0;
    cy.nodes().forEach((node) => {
      node.removeData("highlightFill");
      node.removeData("highlightTextColor");

      const nodeClass = String(node.data("class") || "");
      const label = normalizeGeneLabel(node.data("label"));
      if (!nodeClass.includes("macromolecule") || !highlightMap.has(label)) {
        return;
      }

      const fill = highlightMap.get(label);
      node.data("highlightFill", fill);
      node.data("highlightTextColor", textColorForFill(fill));
      matchCount += 1;
    });

    return matchCount;
  }

  function applyPresetGeometry(cy) {
    cy.nodes().forEach((node) => {
      const bbox = node.data("bbox");
      if (!bbox) {
        return;
      }
      node.position({ x: Number(bbox.x) || 0, y: Number(bbox.y) || 0 });
    });
  }

  function applyInteractionRules(cy) {
    cy.nodes(COMPLEX_NODE_SELECTOR).selectify();
    cy.nodes(COMPARTMENT_NODE_SELECTOR).unselect().unselectify().ungrabify();
  }

  function sendGraphCounts(renderer, payload, highlightMatches) {
    if (!window.Shiny || !payload) {
      return;
    }

    setShinyInput(renderer.countsInputId, {
      reactome_id: payload.reactome_id,
      nodes: renderer.cy.nodes().length,
      edges: renderer.cy.edges().length,
      highlighted_nodes: highlightMatches,
      nonce: Math.random(),
    });
  }

  async function loadPathway(renderer, payload) {
    if (!renderer || !payload || !payload.sbgn_url) {
      return;
    }

    renderer.currentPayload = payload;
    setMessage(renderer, "Loading graph...");

    try {
      const response = await fetch(payload.sbgn_url, { cache: "no-store" });
      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const xmlText = await response.text();
      const graph = window.sbgnmlToCytoscape(xmlText);
      const elements = collectSbgnXmlExtras(xmlText, graph);

      renderer.cy.elements().remove();
      renderer.cy.add(elements);
      applyInteractionRules(renderer.cy);
      applyPresetGeometry(renderer.cy);
      const highlightMatches = applyHighlights(renderer.cy, payload.highlighted_genes);
      renderer.cy.nodes().lock();
      renderer.cy.layout({ name: "preset", fit: false }).run();
      resizeAndFit(renderer);

      const highlightText =
        payload.highlighted_genes && payload.highlighted_genes.length > 0
          ? `; ${highlightMatches} highlighted`
          : "";
      setMessage(
        renderer,
        `${renderer.cy.nodes().length} nodes, ${renderer.cy.edges().length} edges${highlightText}`
      );
      sendGraphCounts(renderer, payload, highlightMatches);
    } catch (error) {
      renderer.cy.elements().remove();
      setMessage(renderer, `Unable to load ${payload.sbgn_url}: ${error.message}`);
      sendGraphCounts(renderer, payload, 0);
    }
  }

  function resizeAndFit(renderer) {
    renderer.cy.resize();
    if (renderer.cy.elements().length > 0 && renderer.container.offsetParent !== null) {
      renderer.cy.fit(undefined, 50);
    }
  }

  function zoomBy(renderer, factor) {
    const minZoom = renderer.cy.minZoom();
    const maxZoom = renderer.cy.maxZoom();
    const targetZoom = Math.max(minZoom, Math.min(maxZoom, renderer.cy.zoom() * factor));
    renderer.cy.zoom({
      level: targetZoom,
      renderedPosition: {
        x: renderer.cy.width() / 2,
        y: renderer.cy.height() / 2,
      },
    });
  }

  function bindControl(id, callback) {
    const element = document.getElementById(id);
    if (element) {
      element.addEventListener("click", callback);
    }
  }

  function bindControls(renderer) {
    const ids = renderer.controlIds;
    bindControl(ids.zoomIn, () => zoomBy(renderer, 1.2));
    bindControl(ids.zoomOut, () => zoomBy(renderer, 1 / 1.2));
    bindControl(ids.fit, () => resizeAndFit(renderer));
    bindControl(ids.panLeft, () => renderer.cy.panBy({ x: 50, y: 0 }));
    bindControl(ids.panRight, () => renderer.cy.panBy({ x: -50, y: 0 }));
    bindControl(ids.panUp, () => renderer.cy.panBy({ x: 0, y: 50 }));
    bindControl(ids.panDown, () => renderer.cy.panBy({ x: 0, y: -50 }));
  }

  function cytoscapeStyle() {
    return [
      {
        selector: "node",
        style: {
          "background-color": "#ffffff",
          "border-color": "#52636f",
          "border-width": 1.4,
          "color": "#1f2933",
          "content": "data(label)",
          "font-size": 10,
          "height": (ele) => getNodeDimension(ele, "h", 34),
          "label": "data(label)",
          "min-zoomed-font-size": 5,
          "overlay-padding": 4,
          "shape": "round-rectangle",
          "text-halign": "center",
          "text-max-width": (ele) => Math.max(getNodeDimension(ele, "w", 80) - 8, 24),
          "text-valign": "center",
          "text-wrap": "wrap",
          "width": (ele) => getNodeDimension(ele, "w", 80),
        },
      },
      {
        selector: COMPARTMENT_NODE_SELECTOR,
        style: {
          "background-color": "#ffffff",
          "background-opacity": 0,
          "border-color": "#8aa89b",
          "border-style": "dashed",
          "border-width": 2,
          "events": "no",
          "font-size": 12,
          "padding": 14,
          "text-halign": "center",
          "text-valign": "top",
          "z-compound-depth": "bottom",
        },
      },
      {
        selector: 'node[class *= "macromolecule"]',
        style: {
          "border-color": "#47718a",
          "shape": "round-rectangle",
        },
      },
      {
        selector: 'node[class *= "simple chemical"]',
        style: {
          "border-color": "#8b7634",
          "shape": "ellipse",
        },
      },
      {
        selector: COMPLEX_NODE_SELECTOR,
        style: {
          "border-color": "#6c5d82",
          "border-width": 2,
          "shape": "round-rectangle",
        },
      },
      {
        selector: 'node[class *= "process"], node[class = "association"], node[class = "dissociation"]',
        style: {
          "background-color": "#ffffff",
          "border-color": "#575f67",
          "content": "",
          "height": (ele) => getNodeDimension(ele, "h", 18),
          "shape": "rectangle",
          "width": (ele) => getNodeDimension(ele, "w", 18),
        },
      },
      {
        selector: 'node[class = "submap"]',
        style: {
          "border-color": "#477b5a",
          "border-width": 2,
          "shape": "round-rectangle",
        },
      },
      {
        selector: 'node[class = "phenotype"]',
        style: {
          "border-color": "#9a5b55",
          "shape": "hexagon",
        },
      },
      {
        selector: 'node[class = "source and sink"]',
        style: {
          "border-color": "#1d2329",
          "content": "",
          "shape": "ellipse",
        },
      },
      {
        selector: "edge",
        style: {
          "curve-style": "bezier",
          "font-size": 9,
          "line-color": "#61717d",
          "target-arrow-color": "#61717d",
          "target-arrow-shape": "triangle",
          "width": 1.3,
        },
      },
      {
        selector: 'edge[class = "consumption"]',
        style: {
          "target-arrow-shape": "none",
        },
      },
      {
        selector: 'edge[class = "inhibition"]',
        style: {
          "target-arrow-shape": "tee",
        },
      },
      {
        selector: 'edge[class = "catalysis"]',
        style: {
          "target-arrow-shape": "circle",
        },
      },
      {
        selector: "node[highlightFill]",
        style: {
          "background-color": "data(highlightFill)",
          "border-color": "#16191f",
          "border-width": 2.4,
          "color": "data(highlightTextColor)",
          "font-weight": 700,
        },
      },
      {
        selector: ":selected",
        style: {
          "border-color": "#1f8a70",
          "line-color": "#1f8a70",
          "target-arrow-color": "#1f8a70",
        },
      },
    ];
  }

  function createRenderer(config) {
    const container = document.getElementById(config.containerId);
    const message = document.getElementById(config.messageId);
    if (!container || !message) {
      return null;
    }

    const renderer = {
      container,
      message,
      countsInputId: config.countsInputId,
      controlIds: config.controlIds,
      currentPayload: null,
      cy: cytoscape({
        container,
        autoungrabify: true,
        boxSelectionEnabled: false,
        minZoom: 0.05,
        maxZoom: 6,
        userPanningEnabled: true,
        userZoomingEnabled: true,
        wheelSensitivity: 0.18,
        style: cytoscapeStyle(),
      }),
    };

    window[config.globalName] = renderer.cy;
    bindControls(renderer);
    return renderer;
  }

  function resizeVisibleRenderers() {
    Object.keys(renderers).forEach((key) => {
      const renderer = renderers[key];
      if (renderer) {
        resizeAndFit(renderer);
      }
    });
  }

  function bindTabResize() {
    window.addEventListener("resize", resizeVisibleRenderers);
    if (window.jQuery) {
      window.jQuery('a[data-toggle="tab"]').on("shown.bs.tab", resizeVisibleRenderers);
    }
  }

  function init() {
    if (!window.cytoscape || !window.sbgnmlToCytoscape) {
      const message = document.getElementById("graph-message");
      if (message) {
        message.textContent = "Cytoscape renderer assets are unavailable.";
        message.hidden = false;
      }
      return;
    }

    renderers.dropdown = createRenderer({
      containerId: "cy",
      messageId: "graph-message",
      countsInputId: "sbgn_graph_counts",
      globalName: "sbgnShinyCy",
      controlIds: {
        zoomIn: "zoom-in",
        fit: "fit",
        zoomOut: "zoom-out",
        panLeft: "pan-left",
        panUp: "pan-up",
        panRight: "pan-right",
        panDown: "pan-down",
      },
    });
    renderers.table = createRenderer({
      containerId: "table-cy",
      messageId: "table-graph-message",
      countsInputId: "table_sbgn_graph_counts",
      globalName: "tableSbgnShinyCy",
      controlIds: {
        zoomIn: "table-zoom-in",
        fit: "table-fit",
        zoomOut: "table-zoom-out",
        panLeft: "table-pan-left",
        panUp: "table-pan-up",
        panRight: "table-pan-right",
        panDown: "table-pan-down",
      },
    });

    bindTabResize();
    Shiny.addCustomMessageHandler("load-sbgn-pathway", (payload) => {
      loadPathway(renderers.dropdown, payload);
    });
    Shiny.addCustomMessageHandler("load-table-sbgn-pathway", (payload) => {
      loadPathway(renderers.table, payload);
    });

    document.addEventListener("shiny:connected", notifyShinyReady, { once: true });
    window.setTimeout(notifyShinyReady, 250);
  }

  document.addEventListener("DOMContentLoaded", init);
})();
