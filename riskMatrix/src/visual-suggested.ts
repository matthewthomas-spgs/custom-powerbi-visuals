"use strict";

/**
 * WHAT CHANGED (high-level):
 * - Responsive sizing using options.viewport (instead of fixed width/height).
 * - Create SVG and layers ONCE in the constructor; use persistent D3 joins.
 * - Safer data extraction with clamping/validation of indices (1..5).
 * - Jitter that stays inside each cell; circle radius adapts to cell size.
 * - Palette-aware cell colors (uses Power BI theme) with fallbacks.
 * - Optional selection/tooltip hooks (note: table mapping limits cross-filtering).
 * - Title/axis labels positioned responsively.
 */

import powerbi from "powerbi-visuals-api";
import { FormattingSettingsService } from "powerbi-visuals-utils-formattingmodel";
import "./../style/visual.less";

import * as d3 from "d3";
// ORIGINAL: import { create_base_matrix } from "./helper";
// UPDATED: prefer an immutable base matrix export; function still works and returns a fresh array.
import { create_base_matrix, MatrixCell, MatrixData } from "./helper";

import VisualConstructorOptions = powerbi.extensibility.visual.VisualConstructorOptions;
import VisualUpdateOptions = powerbi.extensibility.visual.VisualUpdateOptions;
import IVisual = powerbi.extensibility.visual.IVisual;
import DataView = powerbi.DataView;

import { VisualFormattingSettingsModel } from "./settings";

interface Risk {
    category: string;
    consequenceIdx: number; // 1–5
    likelihoodIdx: number;  // 1–5
    // For interactivity (optional)
    selectionId?: powerbi.extensibility.ISelectionId;
    // For rendering
    consequenceLabel?: string;
    likelihoodLabel?: string;
    jitterX?: number;
    jitterY?: number;
    r?: number;
}

// ORIGINAL (unused alias): type Selection<T extends d3.BaseType> = d3.Selection<T, any, any, any>;
// REMOVED: The generic alias wasn’t used; keeping code simpler.

export class Visual implements IVisual {
    private target: HTMLElement;
    private formattingSettingsService: FormattingSettingsService;
    private formattingSettings: VisualFormattingSettingsModel;

    private _container: HTMLDivElement;

    // ORIGINAL fixed margins and size
    private margin_top = 40;
    private margin_bottom = 40;
    private margin_left = 60;
    private margin_right = 40;

    // ORIGINAL (fixed size; causes non-responsive layout):
    // private width = 1000;
    // private height = 600;
    // UPDATED: sizes are derived from options.viewport in update().

    private riskConsequenceLevels = ["Insignificant","Minor","Moderate","Major","Catastrophic"];
    private riskLikelihoodLevels = ["Rare","Unlikely","Possible","Likely","Almost Certain"];

    // ORIGINAL: private colourArray = ["#33CC33", "#FFCC00", "#FFA500", "#FF3333"];
    // UPDATED: use host color palette when available; fallback to this array.
    private fallbackColourArray = ["#33CC33", "#FFCC00", "#FFA500", "#FF3333"];

    private risks: Risk[] = [];
    private data: MatrixData;

    // NEW: keep Power BI host, selection manager, color palette
    private host: powerbi.extensibility.visual.IVisualHost;
    private selectionManager: powerbi.extensibility.ISelectionManager;
    private colorPalette: powerbi.extensibility.IColorPalette | undefined;

    // NEW: keep persistent SVG layers 
    private svg!: d3.Selection<SVGSVGElement, unknown, null, undefined>;
    private rootG!: d3.Selection<SVGGElement, unknown, null, undefined>;
    private axesG!: d3.Selection<SVGGElement, unknown, null, undefined>;
    private cellsG!: d3.Selection<SVGGElement, unknown, null, undefined>;
    private pointsG!: d3.Selection<SVGGElement, unknown, null, undefined>;
    private labelsG!: d3.Selection<SVGGElement, unknown, null, undefined>;
    private titleG!: d3.Selection<SVGTextElement, unknown, null, undefined>;
    private xAxisTitleG!: d3.Selection<SVGTextElement, unknown, null, undefined>;
    private yAxisTitleG!: d3.Selection<SVGTextElement, unknown, null, undefined>;

    constructor(options: VisualConstructorOptions) {
        this.target = options.element;
        this.formattingSettingsService = new FormattingSettingsService();

        this.host = options.host;
        this.selectionManager = this.host.createSelectionManager();
        this.colorPalette = this.host.colorPalette;

        this._container = document.createElement("div");
        this._container.style.position = "relative";
        this._container.style.width = "100%";
        this._container.style.height = "100%";
        this.target.appendChild(this._container);

        // Create SVG ONCE; do not recreate on each update.
        this.svg = d3.select(this._container)
            .append("svg")
            .attr("role", "img")
            .attr("aria-label", "Risk matrix");

        // Layered groups for structured rendering.
        this.rootG = this.svg.append("g").attr("class", "chart-root");
        this.axesG = this.rootG.append("g").attr("class", "axes");
        this.cellsG = this.rootG.append("g").attr("class", "cells");
        this.pointsG = this.rootG.append("g").attr("class", "points");
        this.labelsG = this.rootG.append("g").attr("class", "labels");

        // Titles
        this.titleG = this.svg.append("text")
            .attr("class", "chart-title")
            .attr("text-anchor", "middle")
            .attr("font-weight", "bold");

        this.xAxisTitleG = this.svg.append("text")
            .attr("class", "axis-title x")
            .attr("text-anchor", "middle");

        this.yAxisTitleG = this.svg.append("text")
            .attr("class", "axis-title y")
            .attr("text-anchor", "middle")
            .attr("transform", "rotate(-90)");

        // Base 5×5 matrix (immutable source)
        this.data = create_base_matrix();
    }

    public update(options: VisualUpdateOptions) {
        if (!options.dataViews || options.dataViews.length === 0) return;

        // Keep formatting settings in sync
        this.formattingSettings = this.formattingSettingsService.populateFormattingSettingsModel(
            VisualFormattingSettingsModel,
            options.dataViews[0]
        );

        // Extract and validate data
        this.extractData(options.dataViews[0]);

        // Render with current viewport
        this.renderChart(options);
    }

    /**
     * Clamp helper to keep indices in [1..5] and avoid NaN.
     */
    private clampIndex(v: any, min = 1, max = 5): number | null {
        const n = Number(v);
        if (!Number.isFinite(n)) return null;
        const f = Math.floor(n);
        if (f < min || f > max) return null;
        return f;
    }

    private extractData(dataView: DataView) {
        const table = dataView.table;
        if (!table || !table.rows || !table.columns) {
            this.risks = [];
            return;
        }

        const labelIdx = table.columns.findIndex(c => c.roles?.["riskLabel"]);
        const consequenceIdx = table.columns.findIndex(c => c.roles?.["riskConsequenceRating"]);
        const likelihoodIdx = table.columns.findIndex(c => c.roles?.["riskLikelihoodRating"]);

        if (labelIdx < 0 || consequenceIdx < 0 || likelihoodIdx < 0) {
            this.risks = [];
            return;
        }

        // Create selection Id builder (NOTE: table mapping lacks category identity; this is a placeholder
        // so clicking can still provide basic selection state, but cross-filtering will not occur
        // unless you switch to a categorical mapping and pass real identities).
        const baseSelectionId = this.host.createSelectionIdBuilder().createSelectionId();

        this.risks = table.rows
            .map(row => {
                const cIdx = this.clampIndex(row[consequenceIdx]);
                const lIdx = this.clampIndex(row[likelihoodIdx]);
                if (cIdx === null || lIdx === null) return null;
                const category = row[labelIdx] != null ? String(row[labelIdx]) : "N/A";
                return {
                    category,
                    consequenceIdx: cIdx,
                    likelihoodIdx: lIdx,
                    selectionId: baseSelectionId
                } as Risk;
            })
            .filter((r): r is Risk => r !== null);
    }

    // ORIGINAL:
    // private convertConsequenceValues(key: number): string {
    //     return this.riskConsequenceLevels[key - 1] ?? "Catastrophic";
    // }
    // private convertLikelihoodValues(key: number): string {
    //     return this.riskLikelihoodLevels[key - 1] ?? "Almost Certain";
    // }
    // UPDATED: return a safe mapped label or null; we avoid misleading fallbacks.
    private consequenceLabelFromIndex(key: number): string | null {
        return this.riskConsequenceLevels[key - 1] ?? null;
    }
    private likelihoodLabelFromIndex(key: number): string | null {
        return this.riskLikelihoodLevels[key - 1] ?? null;
    }

    /**
     * Map base severity index (0..3) to palette-aware color, with fallbacks.
     */
    private colorForRiskIndex(idx: number): string {
        // Attempt to use semantic palette names; if not defined, fallback to array.
        // You can also expose via formatting settings (e.g., low/mod/high/extreme).
        const fallback = this.fallbackColourArray[idx] ?? "#cccccc";

        if (!this.colorPalette) return fallback;

        // getColor with a consistent key helps themes retain stable mapping.
        const keys = ["risk-low", "risk-moderate", "risk-high", "risk-extreme"];
        const chosenKey = keys[idx] ?? `risk-${idx}`;
        const c = this.colorPalette.getColor(chosenKey);
        return c?.value ?? fallback;
    }

    /**
     * Compute jittered positions for each cell, keeping them within the cell bounds.
     */
    private computeJitteredRisks(
        x: d3.ScaleBand<string>,
        y: d3.ScaleBand<string>,
        width: number,
        height: number
    ): Risk[] {
        const cellGroups = d3.group(
            this.risks,
            d => `${d.consequenceIdx}-${d.likelihoodIdx}`
        );

        const cellW = Math.max(1, x.bandwidth());
        const cellH = Math.max(1, y.bandwidth());

        // Adaptive circle radius based on cell size:
        const baseRadius = Math.max(2, Math.min(cellW, cellH) * 0.18);
        const paddingInCell = Math.max(1, Math.min(cellW, cellH) * 0.12);
        const maxJitterX = (cellW / 2) - baseRadius - paddingInCell;
        const maxJitterY = (cellH / 2) - baseRadius - paddingInCell;

        // Helper to distribute n points in rings within available jitter box
        function jitterPositions(n: number): [number, number][] {
            if (n <= 1) return [[0, 0]];
            const positions: [number, number][] = [];
            const rings = Math.ceil(Math.sqrt(n));
            let placed = 0;

            for (let r = 0; r < rings && placed < n; r++) {
                const k = r === 0 ? 1 : Math.ceil(2 * Math.PI * (r + 1));
                for (let i = 0; i < k && placed < n; i++) {
                    const t = (i / k) * 2 * Math.PI;
                    const scale = (r + 1) / rings;
                    const jx = Math.max(-maxJitterX, Math.min(maxJitterX, scale * maxJitterX * Math.cos(t)));
                    const jy = Math.max(-maxJitterY, Math.min(maxJitterY, scale * maxJitterY * Math.sin(t)));
                    positions.push([jx, jy]);
                    placed++;
                }
            }
            return positions;
        }

        const jittered: Risk[] = [];

        for (const [key, group] of cellGroups.entries()) {
            const [cIdxStr, lIdxStr] = key.split("-");
            const cIdx = Number(cIdxStr);
            const lIdx = Number(lIdxStr);
            const cLabel = this.consequenceLabelFromIndex(cIdx);
            const lLabel = this.likelihoodLabelFromIndex(lIdx);
            if (!cLabel || !lLabel) continue;

            const pos = jitterPositions(group.length);
            for (let i = 0; i < group.length; i++) {
                const g = group[i];
                jittered.push({
                    ...g,
                    consequenceLabel: cLabel,
                    likelihoodLabel: lLabel,
                    jitterX: pos[i][0],
                    jitterY: pos[i][1],
                    r: baseRadius
                });
            }
        }

        return jittered;
    }

    // ORIGINAL:
    // private renderChart() {
    //     this._container.innerHTML = "";
    //     const svg = d3.select(this._container)
    //         .append("svg")
    //         .attr("width", this.width + this.margin_left + this.margin_right)
    //         .attr("height", this.height + this.margin_top + this.margin_bottom);
    //     // ... omitted for brevity (recreated nodes each update, fixed sizes)
    // }
    //
    // UPDATED: responsive rendering; persistent nodes; axis & title placement; safe joins.
    private renderChart(options: VisualUpdateOptions) {
        const vp = options.viewport;
        const fullW = Math.max(0, vp.width);
        const fullH = Math.max(0, vp.height);

        // Inner chart area
        const width = Math.max(0, fullW - (this.margin_left + this.margin_right));
        const height = Math.max(0, fullH - (this.margin_top + this.margin_bottom));

        // SVG sizing and root translation
        this.svg
            .attr("width", fullW)
            .attr("height", fullH)
            .attr("viewBox", `0 0 ${fullW} ${fullH}`);

        this.rootG.attr("transform", `translate(${this.margin_left}, ${this.margin_top})`);

        // Titles from formatting settings (fallbacks)
        const titleText = (this.formattingSettings as any)?.title?.text?.value ?? "Risk Matrix";
        const titleFontSize = (this.formattingSettings as any)?.title?.fontSize?.value ?? 20;

        this.titleG
            .text(titleText)
            .attr("x", fullW / 2)
            .attr("y", Math.max(20, this.margin_top * 0.6))
            .attr("font-size", `${titleFontSize}px`);

        const xAxisTitle = "Consequence";
        const yAxisTitle = "Likelihood";

        this.xAxisTitleG
            .text(xAxisTitle)
            .attr("x", this.margin_left + width / 2)
            .attr("y", fullH - Math.max(10, this.margin_bottom * 0.3))
            .attr("font-size", "12px");

        this.yAxisTitleG
            .text(yAxisTitle)
            .attr("x", -(this.margin_top + height / 2))
            .attr("y", Math.max(16, this.margin_left * 0.4))
            .attr("font-size", "12px");

        // Scales
        const x = d3.scaleBand<string>()
            .domain(this.riskConsequenceLevels)
            .range([0, width])
            .padding(0.03);

        const y = d3.scaleBand<string>()
            .domain(this.riskLikelihoodLevels)
            .range([height, 0])
            .padding(0.03);

        // Axes (recreate inside axesG each update to match scale sizes)
        this.axesG.selectAll("*").remove();

        const xAxisG = this.axesG.append("g")
            .attr("transform", `translate(0, ${height})`)
            .call(d3.axisBottom(x));

        const yAxisG = this.axesG.append("g")
            .call(d3.axisLeft(y));

        // Base cells (5×5)
        const cells = this.cellsG
            .selectAll<SVGRectElement, MatrixCell>("rect.cell")
            .data(this.data, (d: any) => `${d.consequence}|${d.likelihood}`);

        cells.join(
            enter => enter.append("rect")
                .attr("class", "cell")
                .attr("x", d => x(d.consequence)!)
                .attr("y", d => y(d.likelihood)!)
                .attr("width", x.bandwidth())
                .attr("height", y.bandwidth())
                .attr("fill", d => this.colorForRiskIndex(d.colour))
                .attr("stroke", this.colorPalette?.foreground?.value ?? "#eeeeee")
                .attr("stroke-width", 1),
            update => update
                .attr("x", d => x(d.consequence)!)
                .attr("y", d => y(d.likelihood)!)
                .attr("width", x.bandwidth())
                .attr("height", y.bandwidth()),
            exit => exit.remove()
        );

        // Compute jittered risks with adaptive radius
        const jitteredRisks = this.computeJitteredRisks(x, y, width, height);

        // Points
        const pointColor = (this.formattingSettings as any)?.points?.color?.value ?? "#1f77b4";

        const points = this.pointsG
            .selectAll<SVGCircleElement, Risk>("circle.risk-point")
            .data(jitteredRisks, (d: any) => `${d.category}-${d.consequenceIdx}-${d.likelihoodIdx}`);

        points.join(
            enter => enter.append("circle")
                .attr("class", "risk-point")
                .attr("r", d => d.r!)
                .attr("cx", d => x(d.consequenceLabel!)! + x.bandwidth() / 2 + (d.jitterX ?? 0))
                .attr("cy", d => y(d.likelihoodLabel!)! + y.bandwidth() / 2 + (d.jitterY ?? 0))
                .attr("fill", pointColor)
                .attr("opacity", 0.9)
                .style("cursor", "pointer")
                .on("click", (event, d) => {
                    // NOTE: selectionId is not tied to a category due to table mapping.
                    // If you switch to 'categorical', wire a real identity here.
                    const multi = event.ctrlKey || event.metaKey;
                    this.selectionManager.select(d.selectionId!, multi);
                    event.stopPropagation();
                })
                .append("title")
                .text(d =>
                    `Risk: ${d.category}
Likelihood: ${d.likelihoodLabel}
Consequence: ${d.consequenceLabel}`
                ),
            update => update
                .attr("r", d => d.r!)
                .attr("cx", d => x(d.consequenceLabel!)! + x.bandwidth() / 2 + (d.jitterX ?? 0))
                .attr("cy", d => y(d.likelihoodLabel!)! + y.bandwidth() / 2 + (d.jitterY ?? 0)),
            exit => exit.remove()
        );

        // Labels
        const nominalFontSize = Math.min(x.bandwidth(), y.bandwidth()) * 0.28;
        const labelFontSize = (this.formattingSettings as any)?.labels?.fontSize?.value
            ?? Math.max(10, Math.min(14, Math.floor(nominalFontSize)));
        const labelColor = (this.formattingSettings as any)?.labels?.color?.value ?? "#ffffff";
        const showLabels = (this.formattingSettings as any)?.labels?.show?.value ?? true;

        const labelsSel = this.labelsG
            .selectAll<SVGTextElement, Risk>("text.risk-label")
            .data(showLabels ? jitteredRisks : [], (d: any) => `${d.category}-${d.consequenceIdx}-${d.likelihoodIdx}`);

        labelsSel.join(
            enter => enter.append("text")
                .attr("class", "risk-label")
                .attr("text-anchor", "middle")
                .attr("fill", labelColor)
                .style("font-weight", "bold")
                .style("font-size", `${labelFontSize}px`)
                .attr("x", d => x(d.consequenceLabel!)! + x.bandwidth() / 2 + (d.jitterX ?? 0))
                .attr("y", d => y(d.likelihoodLabel!)! + y.bandwidth() / 2 + (d.jitterY ?? 0) + (labelFontSize * 0.35))
                .text(d => d.category),
            update => update
                .style("font-size", `${labelFontSize}px`)
                .attr("x", d => x(d.consequenceLabel!)! + x.bandwidth() / 2 + (d.jitterX ?? 0))
                .attr("y", d => y(d.likelihoodLabel!)! + y.bandwidth() / 2 + (d.jitterY ?? 0) + (labelFontSize * 0.35))
                .text(d => d.category),
            exit => exit.remove()
        );

        // High-contrast handling
        if (this.colorPalette?.isHighContrast) {
            cells.attr("fill", this.colorPalette.background.value);
            cells.attr("stroke", this.colorPalette.foreground.value);
            points.attr("fill", this.colorPalette.foreground.value);
            labelsSel.attr("fill", this.colorPalette.foreground.value);
        }

        // Clear selection when clicking on empty space
        d3.select(this._container).on("click", () => this.selectionManager.clear());
    }

    public getFormattingModel(): powerbi.visuals.FormattingModel {
        return this.formattingSettingsService.buildFormattingModel(this.formattingSettings);
    }
}