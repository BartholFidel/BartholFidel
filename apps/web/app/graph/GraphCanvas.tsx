"use client";

import type { GraphEdge, GraphNode } from "@bartholfidel/shared";
import type { Core, ElementDefinition, StylesheetStyle } from "cytoscape";
import { useEffect, useRef } from "react";
import CytoscapeComponent from "react-cytoscapejs";

interface GraphCanvasProps {
  nodes: GraphNode[];
  edges: GraphEdge[];
  centerNodeId: string | null;
  highlightedNodeIds: string[];
  highlightedEdgeIds: string[];
  onEdgeSelect: (edgeId: string | null) => void;
}

// Hex tokens mirrored from tailwind.config.ts so cytoscape canvas matches the app theme.
const COLOR = {
  surface: "#0a0e17",
  surfaceRaised: "#111827",
  border: "#1f2937",
  accent: "#06b6d4",
  accentMuted: "#0891b2",
  online: "#10b981",
  offline: "#ef4444",
  web2: "#06b6d4", // accent (cyan) for web2 entities
  web3: "#a855f7", // violet for web3 entities
  text: "#e5e7eb",
  faded: "#374151",
} as const;

function toElements(nodes: GraphNode[], edges: GraphEdge[]): ElementDefinition[] {
  const nodeEls: ElementDefinition[] = nodes.map((n) => ({
    data: {
      id: n.id,
      label: n.name,
      type: n.type,
      source: n.source,
      risk: n.risk_tier,
      compromised: n.historically_compromised ? "1" : "0",
    },
    classes: n.source === "web3" ? "web3" : "web2",
  }));
  const edgeEls: ElementDefinition[] = edges.map((e) => ({
    data: {
      id: e.id,
      source: e.source_entity_id,
      target: e.target_entity_id,
      label: e.relationship_type,
    },
  }));
  return [...nodeEls, ...edgeEls];
}

const STYLESHEET: StylesheetStyle[] = [
  {
    selector: "node",
    style: {
      label: "data(label)",
      color: COLOR.text,
      "font-size": "10px",
      "font-family": "ui-monospace, monospace",
      "text-valign": "bottom",
      "text-halign": "center",
      "text-margin-y": 4,
      width: 28,
      height: 28,
      "border-width": 2,
      "border-color": COLOR.border,
    },
  },
  {
    selector: "node.web2",
    style: { "background-color": COLOR.web2 },
  },
  {
    selector: "node.web3",
    style: { "background-color": COLOR.web3 },
  },
  // High-risk or historically compromised entities get a red ring.
  {
    selector: 'node[risk = "high"], node[compromised = "1"]',
    style: { "border-color": COLOR.offline, "border-width": 4 },
  },
  {
    selector: "edge",
    style: {
      width: 2,
      "line-color": COLOR.border,
      "target-arrow-color": COLOR.border,
      "target-arrow-shape": "triangle",
      "curve-style": "bezier",
      label: "data(label)",
      "font-size": "8px",
      "font-family": "ui-monospace, monospace",
      color: "#9ca3af",
      "text-rotation": "autorotate",
      "text-background-color": COLOR.surface,
      "text-background-opacity": 1,
      "text-background-padding": "2px",
    },
  },
  // Selected edge (clicked for deletion).
  {
    selector: "edge:selected",
    style: { "line-color": COLOR.accent, "target-arrow-color": COLOR.accent, width: 3 },
  },
  // Shortest-path highlight.
  {
    selector: ".highlighted",
    style: {
      "line-color": COLOR.online,
      "target-arrow-color": COLOR.online,
      "background-color": COLOR.online,
      "border-color": COLOR.online,
      width: 4,
      "z-index": 999,
    },
  },
  // Everything not on the path is dimmed while a path is shown.
  {
    selector: ".faded",
    style: { opacity: 0.2 },
  },
];

// animate:false on purpose — an animated cose layout leaves animation frames
// in flight, and React StrictMode's dev double-mount destroys the cytoscape
// instance mid-tick, throwing "reading 'notify' of null". Snapping the layout
// avoids the orphaned frames (and reads better for a static data graph).
const LAYOUT = {
  name: "cose",
  animate: false,
  nodeRepulsion: 8000,
  idealEdgeLength: 90,
  padding: 30,
} as const;

export default function GraphCanvas({
  nodes,
  edges,
  centerNodeId,
  highlightedNodeIds,
  highlightedEdgeIds,
  onEdgeSelect,
}: GraphCanvasProps): JSX.Element {
  const cyRef = useRef<Core | null>(null);

  const elements = toElements(nodes, edges);

  // Re-run layout whenever the element set changes, else new nodes pile at the origin.
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) {
      return;
    }
    cy.layout(LAYOUT).run();
  }, [nodes, edges]);

  // Center / zoom on the searched node.
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy || !centerNodeId) {
      return;
    }
    const node = cy.getElementById(centerNodeId);
    if (node.empty()) {
      return;
    }
    cy.elements().unselect();
    node.select();
    cy.animate({ center: { eles: node }, zoom: 1.6 }, { duration: 400 });
  }, [centerNodeId]);

  // Apply shortest-path highlight / fade classes.
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) {
      return;
    }
    cy.elements().removeClass("highlighted faded");
    if (highlightedNodeIds.length === 0 && highlightedEdgeIds.length === 0) {
      return;
    }
    const nodeSet = new Set(highlightedNodeIds);
    const edgeSet = new Set(highlightedEdgeIds);
    cy.nodes().forEach((n) => {
      n.addClass(nodeSet.has(n.id()) ? "highlighted" : "faded");
    });
    cy.edges().forEach((e) => {
      e.addClass(edgeSet.has(e.id()) ? "highlighted" : "faded");
    });
  }, [highlightedNodeIds, highlightedEdgeIds]);

  return (
    <CytoscapeComponent
      elements={elements}
      stylesheet={STYLESHEET}
      layout={LAYOUT}
      style={{ width: "100%", height: "100%" }}
      cy={(cy: Core) => {
        if (cyRef.current === cy) {
          return;
        }
        cyRef.current = cy;
        cy.on("tap", "edge", (evt) => {
          onEdgeSelect(evt.target.id());
        });
        cy.on("tap", (evt) => {
          if (evt.target === cy) {
            onEdgeSelect(null);
          }
        });
      }}
    />
  );
}
