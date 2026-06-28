# PURPOSE ----
# Run a Shiny demo for Reactome SBGN diagrams rendered with Cytoscape.js.

suppressPackageStartupMessages({
  library(DT)
  library(jsonlite)
  library(shiny)
})

# CONFIGURATION ----
app_dir <- normalizePath(getwd(), mustWork = TRUE)
data_dir <- file.path(app_dir, "data")
sbgn_dir <- file.path(data_dir, "reactome_homo_sapiens.sbgn_20260612")
pathway_file <- file.path(data_dir, "ReactomePathways.txt")
highlight_file <- file.path(data_dir, "highlighted_examples.json")

# FUNCTIONS ----

#' Return a fallback value for NULL inputs.
#'
#' @param value Value to test.
#' @param fallback Value returned when `value` is NULL.
#'
#' @return `value` unless it is NULL, otherwise `fallback`.
or_else <- function(value, fallback) {
  if (is.null(value)) {
    return(fallback)
  }
  value
}

#' Load Reactome pathways that have local SBGN files.
#'
#' @return Data frame with reactome_id, pathway_name, species, and sbgn_path.
load_pathways <- function() {
  sbgn_paths <- list.files(sbgn_dir, pattern = "\\.sbgn$", full.names = TRUE)
  sbgn_ids <- tools::file_path_sans_ext(basename(sbgn_paths))

  pathways <- read.delim(
    pathway_file,
    header = FALSE,
    sep = "\t",
    quote = "",
    stringsAsFactors = FALSE,
    col.names = c("reactome_id", "pathway_name", "species")
  )
  pathways <- pathways[pathways$reactome_id %in% sbgn_ids, ]
  pathways$sbgn_path <- file.path(
    sbgn_dir,
    paste0(pathways$reactome_id, ".sbgn")
  )

  missing_ids <- setdiff(sbgn_ids, pathways$reactome_id)
  if (length(missing_ids) > 0) {
    missing_pathways <- data.frame(
      reactome_id = missing_ids,
      pathway_name = missing_ids,
      species = "Homo sapiens",
      sbgn_path = file.path(sbgn_dir, paste0(missing_ids, ".sbgn")),
      stringsAsFactors = FALSE
    )
    pathways <- rbind(pathways, missing_pathways)
  }

  pathways[order(tolower(pathways$pathway_name), pathways$reactome_id), ]
}

#' Create named pathway choices for Shiny inputs.
#'
#' @param pathways Data frame returned by load_pathways().
#' @param reactome_ids Optional Reactome IDs to include.
#'
#' @return Named character vector with pathway-name labels and ID values.
pathway_choices <- function(pathways, reactome_ids = NULL) {
  if (!is.null(reactome_ids)) {
    pathways <- pathways[match(reactome_ids, pathways$reactome_id), ]
    pathways <- pathways[!is.na(pathways$reactome_id), ]
  }
  stats::setNames(pathways$reactome_id, pathways$pathway_name)
}

#' Load pre-generated highlighted examples.
#'
#' @return List of highlighted example records.
load_highlight_examples <- function() {
  if (!file.exists(highlight_file)) {
    stop(
      paste(
        "Missing highlighted_examples.json.",
        "Place highlighted_examples.json under demo_sbgn_shiny_js/data."
      )
    )
  }
  fromJSON(highlight_file, simplifyVector = FALSE)
}

#' Find a highlighted example by Reactome ID.
#'
#' @param examples List of highlighted examples.
#' @param reactome_id Selected Reactome pathway ID.
#'
#' @return Highlighted example record, or NULL when not found.
find_highlight_example <- function(examples, reactome_id) {
  matches <- vapply(examples, function(example) {
    identical(example$reactome_id, reactome_id)
  }, logical(1))
  match_index <- which(matches)[1]
  if (is.na(match_index)) {
    return(NULL)
  }
  examples[[match_index]]
}

#' Convert a highlighted example to a JavaScript payload.
#'
#' @param example Highlighted example record, or NULL.
#'
#' @return List of gene/color records.
highlight_payload <- function(example) {
  if (is.null(example)) {
    return(list())
  }

  lapply(example$highlighted_genes, function(item) {
    list(
      gene = item$gene,
      color = item$color
    )
  })
}

#' Format selected gene labels for display.
#'
#' @param example Highlighted example record, or NULL.
#'
#' @return Comma-delimited gene labels, or NA.
highlight_gene_text <- function(example) {
  if (is.null(example)) {
    return("NA")
  }

  gene_labels <- vapply(
    example$highlighted_genes,
    function(item) item$gene,
    character(1)
  )
  paste(gene_labels, collapse = ", ")
}

#' Format a highlighted example row's gene labels for display.
#'
#' @param highlighted_genes List of highlighted gene/color records.
#'
#' @return Comma-delimited gene labels.
highlighted_gene_list_text <- function(highlighted_genes) {
  gene_labels <- vapply(
    highlighted_genes,
    function(item) item$gene,
    character(1)
  )
  paste(gene_labels, collapse = ", ")
}

#' Build the highlighted example table.
#'
#' @param examples List of highlighted example records.
#'
#' @return Data frame for DT rendering.
highlight_table_data <- function(examples) {
  data.frame(
    reactome_id = vapply(examples, function(example) {
      example$reactome_id
    }, character(1)),
    pathway_name = vapply(examples, function(example) {
      example$pathway_name
    }, character(1)),
    size_group = vapply(examples, function(example) {
      example$size_group
    }, character(1)),
    highlighted_genes = vapply(examples, function(example) {
      highlighted_gene_list_text(example$highlighted_genes)
    }, character(1)),
    stringsAsFactors = FALSE
  )
}

#' Convert pathway names into table links.
#'
#' @param table_data Highlighted example table data.
#'
#' @return Data frame with linked pathway_name values.
link_pathway_names <- function(table_data) {
  table_data$pathway_name <- sprintf(
    paste0(
      "<a href=\"#\" class=\"table-pathway-link\" ",
      "data-reactome-id=\"%s\">%s</a>"
    ),
    htmltools::htmlEscape(table_data$reactome_id),
    htmltools::htmlEscape(table_data$pathway_name)
  )
  table_data[, c("pathway_name", "size_group", "highlighted_genes")]
}

#' Safely format a graph count received from JavaScript.
#'
#' @param counts List received from the Cytoscape renderer.
#' @param field Count field to format.
#' @param reactome_id Currently selected Reactome ID.
#'
#' @return Formatted count or "loading".
format_graph_count <- function(counts, field, reactome_id) {
  if (
    is.null(counts) ||
      !identical(counts$reactome_id, reactome_id) ||
      is.null(counts[[field]])
  ) {
    return("loading")
  }

  format(as.integer(counts[[field]]), big.mark = ",")
}

# LOAD DATA ----
pathways <- load_pathways()
highlight_examples <- load_highlight_examples()
static_choices <- pathway_choices(pathways)
highlight_ids <- vapply(highlight_examples, function(example) {
  example$reactome_id
}, character(1))
highlight_choices <- pathway_choices(pathways, highlight_ids)
highlight_table <- highlight_table_data(highlight_examples)

addResourcePath("sbgn-files", sbgn_dir)

# USER INTERFACE ----
ui <- fluidPage(
  tags$head(
    tags$title("SBGN Cytoscape Shiny Demo"),
    tags$link(rel = "stylesheet", href = "styles.css"),
    tags$script(src = "vendor/cytoscape/cytoscape.min.js"),
    tags$script(src = "vendor/sbgnml-to-cytoscape/sbgnml-to-cytoscape.js")
  ),
  tabsetPanel(
    id = "demo_tabs",
    tabPanel(
      "Dropdown Test",
      div(
        class = "app-shell",
        tags$aside(
          class = "side-menu",
          tags$h1("SBGN Cytoscape"),
          div(
            class = "side-controls",
            selectInput(
              "diagram_type",
              "Type",
              choices = c("static", "highlighted")
            ),
            selectizeInput("diagram_choice", "Pathway", choices = NULL)
          ),
          div(
            class = "side-meta",
            div(
              sprintf(
                "%s local pathways",
                format(nrow(pathways), big.mark = ",")
              )
            ),
            div(sprintf("%s highlight examples", length(highlight_examples)))
          )
        ),
        tags$main(
          class = "main-panel",
          uiOutput("pathway_metadata"),
          div(
            class = "graph-frame",
            div(
              class = "cy-controls",
              tags$button(
                id = "zoom-in",
                title = "Zoom in",
                type = "button",
                "+"
              ),
              tags$button(
                id = "fit",
                title = "Fit graph",
                type = "button",
                "fit"
              ),
              tags$button(
                id = "zoom-out",
                title = "Zoom out",
                type = "button",
                "-"
              ),
              tags$button(
                id = "pan-left",
                title = "Pan left",
                type = "button",
                HTML("&larr;")
              ),
              tags$button(
                id = "pan-up",
                title = "Pan up",
                type = "button",
                HTML("&uarr;")
              ),
              tags$button(
                id = "pan-right",
                title = "Pan right",
                type = "button",
                HTML("&rarr;")
              ),
              tags$button(
                class = "span-3",
                id = "pan-down",
                title = "Pan down",
                type = "button",
                HTML("&darr;")
              )
            ),
            div(id = "cy", `aria-label` = "SBGN pathway graph"),
            div(class = "graph-message", id = "graph-message", hidden = NA)
          )
        )
      )
    ),
    tabPanel(
      "Table Test",
      div(
        class = "table-test-panel",
        DTOutput("highlight_examples_table"),
        uiOutput("table_pathway_metadata"),
        div(
          class = "graph-frame table-graph-frame",
          div(
            class = "cy-controls",
            tags$button(
              id = "table-zoom-in",
              title = "Zoom in",
              type = "button",
              "+"
            ),
            tags$button(
              id = "table-fit",
              title = "Fit graph",
              type = "button",
              "fit"
            ),
            tags$button(
              id = "table-zoom-out",
              title = "Zoom out",
              type = "button",
              "-"
            ),
            tags$button(
              id = "table-pan-left",
              title = "Pan left",
              type = "button",
              HTML("&larr;")
            ),
            tags$button(
              id = "table-pan-up",
              title = "Pan up",
              type = "button",
              HTML("&uarr;")
            ),
            tags$button(
              id = "table-pan-right",
              title = "Pan right",
              type = "button",
              HTML("&rarr;")
            ),
            tags$button(
              class = "span-3",
              id = "table-pan-down",
              title = "Pan down",
              type = "button",
              HTML("&darr;")
            )
          ),
          div(id = "table-cy", `aria-label` = "Table selected SBGN graph"),
          div(
            class = "graph-message",
            id = "table-graph-message",
            hidden = NA
          )
        )
      )
    )
  ),
  tags$script(src = "sbgn-cytoscape-shiny.js")
)

# SERVER ----
server <- function(input, output, session) {
  table_selected_id <- reactiveVal(highlight_table$reactome_id[[1]])

  observeEvent(input$diagram_type, {
    choices <- if (identical(input$diagram_type, "highlighted")) {
      highlight_choices
    } else {
      static_choices
    }

    updateSelectizeInput(
      session,
      "diagram_choice",
      choices = choices,
      selected = unname(choices[1]),
      server = FALSE
    )
  }, ignoreInit = FALSE)

  selected_example <- reactive({
    req(input$diagram_type, input$diagram_choice)
    if (!identical(input$diagram_type, "highlighted")) {
      return(NULL)
    }
    find_highlight_example(highlight_examples, input$diagram_choice)
  })

  selected_pathway <- reactive({
    req(input$diagram_choice)
    pathway <- pathways[pathways$reactome_id == input$diagram_choice, ]
    shiny::validate(
      shiny::need(nrow(pathway) > 0, "Selected pathway is unavailable.")
    )
    pathway[1, ]
  })

  selected_payload <- reactive({
    pathway <- selected_pathway()
    reactome_id <- as.character(pathway$reactome_id[[1]])
    example <- selected_example()

    list(
      reactome_id = reactome_id,
      pathway_name = as.character(pathway$pathway_name[[1]]),
      sbgn_url = paste0("sbgn-files/", reactome_id, ".sbgn"),
      highlighted_genes = highlight_payload(example)
    )
  })

  observe({
    req(isTRUE(input$cytoscape_ready))
    session$sendCustomMessage("load-sbgn-pathway", selected_payload())
  })

  output$pathway_metadata <- renderUI({
    pathway <- selected_pathway()
    reactome_id <- as.character(pathway$reactome_id[[1]])
    pathway_name <- as.character(pathway$pathway_name[[1]])
    counts <- input$sbgn_graph_counts

    div(
      class = "pathway-metadata",
      div(strong("Pathway: "), pathway_name),
      div(strong("Reactome ID: "), reactome_id),
      div(strong("Genes: "), highlight_gene_text(selected_example())),
      div(strong("Nodes: "), format_graph_count(counts, "nodes", reactome_id)),
      div(strong("Edges: "), format_graph_count(counts, "edges", reactome_id))
    )
  })

  table_selected_example <- reactive({
    req(table_selected_id())
    find_highlight_example(highlight_examples, table_selected_id())
  })

  table_selected_pathway <- reactive({
    req(table_selected_id())
    pathway <- pathways[pathways$reactome_id == table_selected_id(), ]
    shiny::validate(
      shiny::need(nrow(pathway) > 0, "Selected pathway is unavailable.")
    )
    pathway[1, ]
  })

  table_selected_payload <- reactive({
    pathway <- table_selected_pathway()
    reactome_id <- as.character(pathway$reactome_id[[1]])
    example <- table_selected_example()

    list(
      reactome_id = reactome_id,
      pathway_name = as.character(pathway$pathway_name[[1]]),
      sbgn_url = paste0("sbgn-files/", reactome_id, ".sbgn"),
      highlighted_genes = highlight_payload(example)
    )
  })

  output$highlight_examples_table <- renderDT({
    datatable(
      link_pathway_names(highlight_table),
      escape = FALSE,
      rownames = FALSE,
      selection = "none",
      colnames = c("pathway_name", "size_group", "highlighted_genes"),
      options = list(
        pageLength = 10,
        lengthChange = FALSE,
        order = list(list(1, "asc"), list(0, "asc"))
      ),
      callback = JS(
        "table.on('click', 'a.table-pathway-link', function(event) {",
        "  event.preventDefault();",
        "  var id = $(this).data('reactome-id');",
        "  Shiny.setInputValue('table_pathway_click', id, ",
        "    {priority: 'event'});",
        "});"
      )
    )
  })

  observeEvent(input$table_pathway_click, {
    table_selected_id(input$table_pathway_click)
  })

  observe({
    req(isTRUE(input$cytoscape_ready))
    session$sendCustomMessage(
      "load-table-sbgn-pathway",
      table_selected_payload()
    )
  })

  output$table_pathway_metadata <- renderUI({
    pathway <- table_selected_pathway()
    reactome_id <- as.character(pathway$reactome_id[[1]])
    pathway_name <- as.character(pathway$pathway_name[[1]])
    counts <- input$table_sbgn_graph_counts

    div(
      class = "pathway-metadata table-pathway-metadata",
      div(strong("Pathway: "), pathway_name),
      div(strong("Reactome ID: "), reactome_id),
      div(strong("Genes: "), highlight_gene_text(table_selected_example())),
      div(strong("Nodes: "), format_graph_count(counts, "nodes", reactome_id)),
      div(strong("Edges: "), format_graph_count(counts, "edges", reactome_id))
    )
  })
}

# RUN APP ----
shinyApp(ui, server)
