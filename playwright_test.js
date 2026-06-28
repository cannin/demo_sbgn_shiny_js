const { chromium } = require("playwright");
const path = require("path");

const APP_URL = process.env.APP_URL || "http://127.0.0.1:3877";
const OUTPUT_DIR = __dirname;
const TARGET_HIGHLIGHT_ID = "R-HSA-211945";
const TARGET_HIGHLIGHT_NAME = "Phase I - Functionalization of compounds";

async function waitForGraph(page, expectedId) {
  await page.waitForFunction(
    (reactomeId) => {
      const cy = window.sbgnShinyCy;
      const counts = window.Shiny && window.Shiny.shinyapp
        ? window.Shiny.shinyapp.$inputValues.sbgn_graph_counts
        : null;
      return Boolean(
        cy &&
          cy.nodes().length > 0 &&
          counts &&
          (!reactomeId || counts.reactome_id === reactomeId)
      );
    },
    expectedId,
    { timeout: 90000 }
  );
}

async function waitForMetadataCounts(page, expectedId) {
  await page.waitForFunction(
    (reactomeId) => {
      const counts = window.Shiny && window.Shiny.shinyapp
        ? window.Shiny.shinyapp.$inputValues.sbgn_graph_counts
        : null;
      const metadata = document.getElementById("pathway_metadata");
      if (!counts || !metadata) {
        return false;
      }
      if (reactomeId && counts.reactome_id !== reactomeId) {
        return false;
      }

      const nodeText = Number(counts.nodes).toLocaleString();
      const edgeText = Number(counts.edges).toLocaleString();
      return (
        metadata.innerText.includes(`Nodes: ${nodeText}`) &&
        metadata.innerText.includes(`Edges: ${edgeText}`)
      );
    },
    expectedId,
    { timeout: 30000 }
  );
}

async function getGraphSummary(page) {
  return page.evaluate(() => {
    const cy = window.sbgnShinyCy;
    const highlighted = cy.nodes("[highlightFill]").map((node) => ({
      label: node.data("label"),
      fill: node.data("highlightFill"),
      textColor: node.data("highlightTextColor"),
    }));

    return {
      nodes: cy.nodes().length,
      edges: cy.edges().length,
      highlighted,
      message: document.getElementById("graph-message").textContent,
      metadata: document.getElementById("pathway_metadata").innerText,
    };
  });
}

async function getCanvasColorSummary(page) {
  return page.evaluate(() => {
    const cy = window.sbgnShinyCy;
    const targetColors = cy.nodes("[highlightFill]").map((node) => {
      const color = String(node.data("highlightFill")).replace("#", "");
      return [
        Number.parseInt(color.slice(0, 2), 16),
        Number.parseInt(color.slice(2, 4), 16),
        Number.parseInt(color.slice(4, 6), 16),
      ];
    });

    const canvases = Array.from(document.querySelectorAll("#cy canvas"));
    let sampledPixels = 0;
    let nonWhitePixels = 0;
    let highlightLikePixels = 0;

    canvases.forEach((canvas) => {
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) {
        return;
      }

      const image = context.getImageData(0, 0, canvas.width, canvas.height);
      const data = image.data;
      for (let index = 0; index < data.length; index += 16) {
        const red = data[index];
        const green = data[index + 1];
        const blue = data[index + 2];
        const alpha = data[index + 3];
        if (alpha === 0) {
          continue;
        }

        sampledPixels += 1;
        if (red < 245 || green < 245 || blue < 245) {
          nonWhitePixels += 1;
        }

        const matchesHighlight = targetColors.some((target) => {
          return (
            Math.abs(red - target[0]) <= 35 &&
            Math.abs(green - target[1]) <= 35 &&
            Math.abs(blue - target[2]) <= 35
          );
        });
        if (matchesHighlight) {
          highlightLikePixels += 1;
        }
      }
    });

    return {
      sampledPixels,
      nonWhitePixels,
      highlightLikePixels,
      targetColors: cy.nodes("[highlightFill]").map((node) => node.data("highlightFill")),
    };
  });
}

async function verifyTableTab(page) {
  await page.getByRole("tab", { name: "Table Test" }).click();
  await page.waitForFunction(() => {
    return document.querySelectorAll("#highlight_examples_table table tbody tr").length === 10;
  });

  const clicked = await page.evaluate(() => {
    const link = document.querySelector("#highlight_examples_table a.table-pathway-link");
    const result = {
      id: link.dataset.reactomeId,
      text: link.textContent,
    };
    link.click();
    return result;
  });

  await page.waitForFunction(
    (id) => window.Shiny.shinyapp.$inputValues.table_pathway_click === id,
    clicked.id,
    { timeout: 10000 }
  );
  await page.waitForFunction(
    (id) => {
      const counts = window.Shiny.shinyapp.$inputValues.table_sbgn_graph_counts;
      return counts && counts.reactome_id === id;
    },
    clicked.id,
    { timeout: 60000 }
  );
  await page.waitForFunction(
    (id) => {
      const counts = window.Shiny.shinyapp.$inputValues.table_sbgn_graph_counts;
      const metadata = document.getElementById("table_pathway_metadata").innerText;
      return counts && counts.reactome_id === id && !metadata.includes("loading");
    },
    clicked.id,
    { timeout: 30000 }
  );

  const summary = await page.evaluate((clickedPathway) => {
    return {
      clicked: clickedPathway,
      rowCount: document.querySelectorAll("#highlight_examples_table table tbody tr").length,
      headers: Array.from(document.querySelectorAll("#highlight_examples_table table thead th")).map(
        (heading) => heading.textContent.trim()
      ),
      selectedRows: document.querySelectorAll("#highlight_examples_table table tbody tr.selected")
        .length,
      metadata: document.getElementById("table_pathway_metadata").innerText,
      nodes: window.tableSbgnShinyCy.nodes().length,
      edges: window.tableSbgnShinyCy.edges().length,
      highlighted: window.tableSbgnShinyCy.nodes("[highlightFill]").length,
    };
  }, clicked);

  if (summary.rowCount !== 10) {
    throw new Error(`Expected 10 visible table rows, got ${summary.rowCount}.`);
  }
  if (summary.selectedRows !== 0) {
    throw new Error(`Expected no selected table rows, got ${summary.selectedRows}.`);
  }
  if (summary.nodes <= 0 || summary.edges <= 0) {
    throw new Error("Expected table-selected graph to render nodes and edges.");
  }
  if (summary.highlighted < 2) {
    throw new Error(`Expected highlighted table graph nodes, got ${summary.highlighted}.`);
  }

  await page.screenshot({
    path: path.join(OUTPUT_DIR, "playwright_table_cytoscape.png"),
    fullPage: true,
  });
  return summary;
}

async function selectHighlightedPathway(page) {
  await page.waitForFunction(() => {
    const typeSelect = document.getElementById("diagram_type");
    const pathwaySelect = document.getElementById("diagram_choice");
    return Boolean(
      typeSelect &&
        typeSelect.selectize &&
        pathwaySelect &&
      pathwaySelect.selectize
    );
  });

  const previousChoice = await page.evaluate(() => {
    return document.getElementById("diagram_choice").selectize.getValue();
  });
  await page.evaluate(() => {
    document.getElementById("diagram_type").selectize.setValue("highlighted");
  });
  await page.waitForFunction(() => {
    return window.Shiny && window.Shiny.shinyapp
      ? window.Shiny.shinyapp.$inputValues.diagram_type === "highlighted"
      : false;
  });
  await page.waitForFunction(
    (value) => {
      return document.getElementById("diagram_choice").selectize.getValue() !== value;
    },
    previousChoice,
    { timeout: 10000 }
  );

  await page.evaluate(
    ({ id, name }) => {
      const selectize = document.getElementById("diagram_choice").selectize;
      selectize.addOption({ value: id, text: name });
      selectize.setValue(id);
    },
    { id: TARGET_HIGHLIGHT_ID, name: TARGET_HIGHLIGHT_NAME }
  );
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1440, height: 980 } });

  try {
  await page.goto(APP_URL, { waitUntil: "domcontentloaded" });
  await waitForGraph(page, null);
  await waitForMetadataCounts(page, null);
  await page.screenshot({
      path: path.join(OUTPUT_DIR, "playwright_static_cytoscape.png"),
      fullPage: true,
    });

  await selectHighlightedPathway(page);
  await waitForGraph(page, TARGET_HIGHLIGHT_ID);
  await waitForMetadataCounts(page, TARGET_HIGHLIGHT_ID);
    const graphSummary = await getGraphSummary(page);
    const colorSummary = await getCanvasColorSummary(page);

    if (graphSummary.highlighted.length < 2) {
      throw new Error(`Expected highlighted nodes, got ${graphSummary.highlighted.length}.`);
    }
    if (colorSummary.highlightLikePixels <= 0) {
      throw new Error("Expected highlighted colors to be visible in Cytoscape canvas.");
    }

    await page.screenshot({
      path: path.join(OUTPUT_DIR, "playwright_highlighted_cytoscape.png"),
      fullPage: true,
    });

    const tableSummary = await verifyTableTab(page);

    console.log(JSON.stringify({ graphSummary, colorSummary, tableSummary }, null, 2));
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
